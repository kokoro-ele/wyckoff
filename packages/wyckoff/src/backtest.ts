import {
  backtestRequestSchema,
  type BacktestExitReason,
  type BacktestMetrics,
  type BacktestRequest,
  type BacktestRequestInput,
  type BacktestResult,
  type BacktestStrategy,
  type BacktestTrade,
} from "@wyckoff/shared";
import { efficiencyRatio, mean, sma, stdev } from "./indicators.js";
import type { Kline } from "./types.js";

export const BACKTEST_ENGINE_VERSION = "1.1.0";

export type BacktestInputErrorCode = "INVALID_REQUEST" | "NO_DATA" | "INVALID_DATA" | "INSUFFICIENT_DATA";

/** 可由 API 层稳定映射为 4xx 的回测输入错误。 */
export class BacktestInputError extends Error {
  readonly code: BacktestInputErrorCode;

  constructor(code: BacktestInputErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BacktestInputError";
    this.code = code;
  }
}

export interface RunBacktestInput {
  request: BacktestRequest | BacktestRequestInput;
  klines: Kline[];
  /** 仅用于结果审计，不参与策略计算。 */
  dataSource?: string;
  /** 服务端可注入持久化 ID；省略时由引擎生成。 */
  id?: string;
  createdAt?: number;
}

interface EntrySignal {
  action: "enter_long";
  index: number;
  reason: string;
  breakoutResistance?: number;
}

interface ExitSignal {
  action: "exit_long";
  index: number;
  reason: string;
  exitReason: "strategy_signal" | "max_holding";
}

type StrategySignal = EntrySignal | ExitSignal;

interface PendingOrder {
  side: "buy" | "sell";
  signal: StrategySignal;
}

interface OpenPosition {
  quantity: number;
  entryIndex: number;
  entrySignalTime: number;
  entryTime: number;
  entryPrice: number;
  entryFee: number;
  entryReason: string;
  stopPrice: number;
  takeProfitPrice: number;
  breakoutResistance?: number;
}

interface PreparedStrategy {
  name: string;
  description: string;
  warmupBars: number;
  evaluate(index: number, position: OpenPosition | null): StrategySignal | null;
}

interface BacktestWindow {
  /** 含最多 warmupBars 根评估区间之前的数据。 */
  bars: Kline[];
  /** bars 中第一根计入曲线、交易与基准的下标。 */
  evaluationStartIndex: number;
}

const BPS_DIVISOR = 10_000;
const EPSILON = 1e-10;

/**
 * 单标的、只做多的确定性回测引擎。
 *
 * 时序约束：策略只能读取第 i 根及以前已经收盘的 K 线；策略信号统一在 i+1 的
 * 开盘成交。止盈止损属于已持仓后的价格条件单，会在当根 OHLC 内撮合；若无法从
 * OHLC 判断同根内先后顺序，按更保守的止损优先。
 */
export function runBacktest(input: RunBacktestInput): BacktestResult {
  const request = parseRequest(input.request);
  const warmupBars = strategyWarmupBars(request.strategy);
  const { bars, evaluationStartIndex } = selectAndValidateBars(input.klines, request, warmupBars);
  const strategy = prepareStrategy(request.strategy, bars);

  if (bars.length <= strategy.warmupBars) {
    throw new BacktestInputError(
      "INSUFFICIENT_DATA",
      `当前仅有 ${bars.length} 根 K 线，策略至少需要 ${strategy.warmupBars + 1} 根`,
    );
  }

  const createdAt = input.createdAt ?? Date.now();
  const id = input.id ?? createRunId(createdAt);
  const warnings: string[] = [];
  const trades: BacktestTrade[] = [];
  const curve: BacktestResult["curve"] = [];
  const commissionRate = request.commissionBps / BPS_DIVISOR;
  const slippageRate = request.slippageBps / BPS_DIVISOR;
  const evaluationBars = bars.slice(evaluationStartIndex);
  const actualWarmupBars = evaluationStartIndex;
  const firstClose = evaluationBars[0].close;

  let cash = request.initialCapital;
  let position: OpenPosition | null = null;
  let pending: PendingOrder | null = null;
  let totalFees = 0;
  let peakEquity = request.initialCapital;
  let forcedEndOfData = false;
  let ignoredFinalSignal = false;
  let skippedUnsettledEntry = false;
  const usesTPlusOneSettlement = isMainlandAshare(request.symbol);

  const closePosition = (
    barIndex: number,
    rawExitPrice: number,
    exitReason: BacktestExitReason,
    exitReasonText: string,
    exitSignalTime: number | null,
    moment: "open" | "intrabar" | "close",
  ): void => {
    if (!position) return;
    const held = position;
    const exitPrice = adverseFillPrice(rawExitPrice, "sell", slippageRate);
    const exitNotional = exitPrice * held.quantity;
    const exitFee = exitNotional * commissionRate;
    cash += exitNotional - exitFee;
    totalFees += exitFee;

    const grossPnl = (exitPrice - held.entryPrice) * held.quantity;
    const fees = held.entryFee + exitFee;
    const netPnl = grossPnl - fees;
    const entryCost = held.entryPrice * held.quantity + held.entryFee;
    const holdingBars =
      moment === "open" ? Math.max(1, barIndex - held.entryIndex) : Math.max(1, barIndex - held.entryIndex + 1);

    trades.push({
      id: `${id}-trade-${trades.length + 1}`,
      side: "long",
      entrySignalTime: held.entrySignalTime,
      entryTime: held.entryTime,
      entryPrice: round(held.entryPrice, 6),
      exitSignalTime,
      exitTime: bars[barIndex].timestamp,
      exitPrice: round(exitPrice, 6),
      quantity: round(held.quantity, 8),
      grossPnl: round(grossPnl, 2),
      netPnl: round(netPnl, 2),
      returnPct: round(entryCost > 0 ? (netPnl / entryCost) * 100 : 0, 4),
      fees: round(fees, 2),
      holdingBars,
      exitReason,
      entryReason: held.entryReason,
      exitReasonText,
    });
    position = null;
  };

  for (let i = evaluationStartIndex; i < bars.length; i++) {
    const bar = bars[i];
    const isLastBar = i === bars.length - 1;

    // 上一根收盘生成的订单只能在本根开盘执行。
    if (pending) {
      if (pending.side === "buy" && !position && pending.signal.action === "enter_long") {
        // A 股 T+1 下，最后一根开仓无法在数据窗内合法平仓，直接忽略而非制造同日卖出。
        if (usesTPlusOneSettlement && isLastBar) {
          skippedUnsettledEntry = true;
        } else {
          const entryPrice = adverseFillPrice(bar.open, "buy", slippageRate);
          const budget = cash * (request.positionSizePct / 100);
          const quantity = budget / (entryPrice * (1 + commissionRate));
          if (quantity > EPSILON) {
            const entryNotional = entryPrice * quantity;
            const entryFee = entryNotional * commissionRate;
            cash -= entryNotional + entryFee;
            if (Math.abs(cash) < EPSILON) cash = 0;
            totalFees += entryFee;
            position = {
              quantity,
              entryIndex: i,
              entrySignalTime: bars[pending.signal.index].timestamp,
              entryTime: bar.timestamp,
              entryPrice,
              entryFee,
              entryReason: pending.signal.reason,
              stopPrice: entryPrice * (1 - request.stopLossPct / 100),
              takeProfitPrice: entryPrice * (1 + request.takeProfitPct / 100),
              breakoutResistance: pending.signal.breakoutResistance,
            };
          }
        }
      } else if (pending.side === "sell" && position && pending.signal.action === "exit_long") {
        closePosition(
          i,
          bar.open,
          pending.signal.exitReason,
          pending.signal.reason,
          bars[pending.signal.index].timestamp,
          "open",
        );
      }
      pending = null;
    }

    // 先处理开盘跳空，再处理路径未知的同根 high/low；后者双触发时止损优先。
    // 沪深京股票买入当日不可卖出，风控条件从下一根 K 线开始生效。
    if (position && !(usesTPlusOneSettlement && position.entryIndex === i)) {
      const stopPrice = position.stopPrice;
      const takeProfitPrice = position.takeProfitPrice;
      if (bar.open <= stopPrice) {
        closePosition(i, bar.open, "stop_loss", `开盘跳空跌破止损价 ${formatPrice(stopPrice)}`, bar.timestamp, "open");
      } else if (bar.open >= takeProfitPrice) {
        closePosition(
          i,
          takeProfitPrice,
          "take_profit",
          `开盘越过止盈价 ${formatPrice(takeProfitPrice)}，按目标价保守成交`,
          bar.timestamp,
          "open",
        );
      } else {
        const hitStop = bar.low <= stopPrice;
        const hitTakeProfit = bar.high >= takeProfitPrice;
        if (hitStop) {
          closePosition(
            i,
            stopPrice,
            "stop_loss",
            hitTakeProfit
              ? `同根同时触及止损与止盈，按保守规则先在止损价 ${formatPrice(stopPrice)} 成交`
              : `盘中触及止损价 ${formatPrice(stopPrice)}`,
            bar.timestamp,
            "intrabar",
          );
        } else if (hitTakeProfit) {
          closePosition(
            i,
            takeProfitPrice,
            "take_profit",
            `盘中触及止盈价 ${formatPrice(takeProfitPrice)}`,
            bar.timestamp,
            "intrabar",
          );
        }
      }
    }

    let signal: StrategySignal | null = null;
    if (position) {
      const activePosition: OpenPosition = position;
      const heldThroughClose: number = i - activePosition.entryIndex + 1;
      signal =
        heldThroughClose >= request.maxHoldingBars
          ? {
              action: "exit_long",
              index: i,
              exitReason: "max_holding",
              reason: `持有已达上限 ${request.maxHoldingBars} 根 K 线`,
            }
          : strategy.evaluate(i, activePosition);
    } else {
      signal = strategy.evaluate(i, null);
    }

    if (signal) {
      if (isLastBar) ignoredFinalSignal = true;
      else pending = { side: signal.action === "enter_long" ? "buy" : "sell", signal };
    }

    // 协议要求每笔交易都有退出记录；末根收盘结算是 next-bar-open 唯一例外。
    if (isLastBar && position) {
      closePosition(i, bar.close, "end_of_data", "数据结束，按最后一根收盘价结算", null, "close");
      forcedEndOfData = true;
    }

    const equity = cash + (position ? position.quantity * bar.close : 0);
    peakEquity = Math.max(peakEquity, equity);
    const drawdownPct = peakEquity > 0 ? ((equity - peakEquity) / peakEquity) * 100 : 0;
    curve.push({
      timestamp: bar.timestamp,
      equity: round(equity, 2),
      benchmarkEquity: round(request.initialCapital * (bar.close / firstClose), 2),
      drawdownPct: round(drawdownPct, 4),
      inMarket: position !== null,
    });
  }

  if (request.startTime !== undefined && actualWarmupBars < strategy.warmupBars) {
    warnings.push(
      `开始日期前仅取得 ${actualWarmupBars} 根预热 K 线，少于策略所需 ${strategy.warmupBars} 根；` +
        "引擎不会使用不完整指标，首段区间会保持空仓，直到预热完成。",
    );
  }
  const elapsedYears = elapsedCalendarYears(evaluationBars);
  if (elapsedYears < 0.25) {
    warnings.push("评估区间不足约 3 个月，年化收益、波动率和 Sharpe 对样本起止点会非常敏感。");
  }
  if (usesTPlusOneSettlement) {
    warnings.push("已按沪深京股票 T+1 交收约束模拟：买入当根不允许止盈、止损或卖出，风控从下一根 K 线生效。");
  }
  if (skippedUnsettledEntry) warnings.push("最后一根 K 线的待执行买单因 A 股 T+1 下无法在区间内合法平仓，已忽略。");
  if (forcedEndOfData) warnings.push("数据结束时仍有持仓，已按末根收盘价（含卖出滑点和佣金）结算。该成交不是次根开盘成交。");
  if (ignoredFinalSignal) warnings.push("最后一根 K 线产生的策略信号没有下一根开盘可供成交，已忽略。");
  if (trades.length === 0) warnings.push("所选区间内没有形成完整交易。可延长时间范围或调整策略参数。");
  if (request.adjust !== "none") warnings.push(`结果基于 ${request.adjust} 复权序列；数据源若非点时复权，可能包含公司行动修订影响。`);

  const metrics = computeMetrics(request, evaluationBars, curve, trades, totalFees);
  assertFiniteOutput(metrics, curve, trades);

  return {
    id,
    createdAt,
    engineVersion: BACKTEST_ENGINE_VERSION,
    strategyName: strategy.name,
    strategyDescription: strategy.description,
    request,
    data: {
      barCount: evaluationBars.length,
      startTime: evaluationBars[0].timestamp,
      endTime: bars[bars.length - 1].timestamp,
      warmupBars: strategy.warmupBars,
      actualWarmupBars,
      source: input.dataSource ?? "调用方提供的 OHLCV",
      fingerprint: fingerprintBars(bars),
    },
    metrics,
    curve,
    trades,
    warnings,
  };
}

function parseRequest(input: BacktestRequest | BacktestRequestInput): BacktestRequest {
  const parsed = backtestRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new BacktestInputError("INVALID_REQUEST", parsed.error.issues.map((issue) => issue.message).join("；"), {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function selectAndValidateBars(
  klines: Kline[],
  request: BacktestRequest,
  warmupBars: number,
): BacktestWindow {
  if (klines.length === 0) throw new BacktestInputError("NO_DATA", "没有可供回测的 K 线数据");

  // 先校验完整输入，再选择评估区间。不能通过时间过滤悄悄藏掉乱序或坏数据。
  for (let i = 0; i < klines.length; i++) {
    const bar = klines[i];
    const ohlcv = [bar.open, bar.high, bar.low, bar.close, bar.volume, bar.amount];
    if (!Number.isSafeInteger(bar.timestamp) || bar.timestamp <= 0 || !ohlcv.every(Number.isFinite)) {
      throw new BacktestInputError("INVALID_DATA", `第 ${i + 1} 根 K 线包含非有限数值或非法时间戳`);
    }
    if (
      bar.open <= 0 ||
      bar.high <= 0 ||
      bar.low <= 0 ||
      bar.close <= 0 ||
      bar.volume < 0 ||
      bar.amount < 0 ||
      bar.high < Math.max(bar.open, bar.close) ||
      bar.low > Math.min(bar.open, bar.close) ||
      bar.low > bar.high
    ) {
      throw new BacktestInputError("INVALID_DATA", `第 ${i + 1} 根 K 线的 OHLCV 关系非法`);
    }
    if (i > 0 && bar.timestamp <= klines[i - 1].timestamp) {
      throw new BacktestInputError("INVALID_DATA", "K 线必须按时间戳严格递增且不能重复");
    }
  }

  const evaluationStart =
    request.startTime === undefined ? 0 : klines.findIndex((bar) => bar.timestamp >= request.startTime!);
  if (evaluationStart < 0) throw new BacktestInputError("NO_DATA", "所选时间范围内没有 K 线数据");

  let evaluationEnd = klines.length - 1;
  if (request.endTime !== undefined) {
    while (evaluationEnd >= evaluationStart && klines[evaluationEnd].timestamp > request.endTime) evaluationEnd--;
  }
  if (evaluationEnd < evaluationStart) throw new BacktestInputError("NO_DATA", "所选时间范围内没有 K 线数据");

  const analysisStart = Math.max(0, evaluationStart - warmupBars);
  return {
    bars: klines.slice(analysisStart, evaluationEnd + 1),
    evaluationStartIndex: evaluationStart - analysisStart,
  };
}

function strategyWarmupBars(strategy: BacktestStrategy): number {
  return strategy.type === "ma_cross"
    ? strategy.slowPeriod
    : Math.max(strategy.rangeLookback, strategy.volumeLookback);
}

function prepareStrategy(strategy: BacktestStrategy, bars: Kline[]): PreparedStrategy {
  if (strategy.type === "ma_cross") return prepareMaCross(strategy, bars);
  return prepareWyckoffBreakout(strategy, bars);
}

function prepareMaCross(strategy: Extract<BacktestStrategy, { type: "ma_cross" }>, bars: Kline[]): PreparedStrategy {
  const closes = bars.map((bar) => bar.close);
  const fast = sma(closes, strategy.fastPeriod);
  const slow = sma(closes, strategy.slowPeriod);

  return {
    name: "双均线交叉",
    description: `MA${strategy.fastPeriod} 上穿 MA${strategy.slowPeriod} 后次根开盘做多，下穿后次根开盘退出。`,
    warmupBars: strategy.slowPeriod,
    evaluate(index, position) {
      if (index < strategy.slowPeriod) return null;
      const previousFast = fast[index - 1];
      const previousSlow = slow[index - 1];
      const currentFast = fast[index];
      const currentSlow = slow[index];
      if (![previousFast, previousSlow, currentFast, currentSlow].every(Number.isFinite)) return null;

      if (!position && previousFast <= previousSlow && currentFast > currentSlow) {
        return {
          action: "enter_long",
          index,
          reason: `MA${strategy.fastPeriod} ${formatPrice(currentFast)} 上穿 MA${strategy.slowPeriod} ${formatPrice(currentSlow)}`,
        };
      }
      if (position && previousFast >= previousSlow && currentFast < currentSlow) {
        return {
          action: "exit_long",
          index,
          exitReason: "strategy_signal",
          reason: `MA${strategy.fastPeriod} ${formatPrice(currentFast)} 下穿 MA${strategy.slowPeriod} ${formatPrice(currentSlow)}`,
        };
      }
      return null;
    },
  };
}

function prepareWyckoffBreakout(
  strategy: Extract<BacktestStrategy, { type: "wyckoff_breakout" }>,
  bars: Kline[],
): PreparedStrategy {
  const warmupBars = Math.max(strategy.rangeLookback, strategy.volumeLookback);

  return {
    name: "Wyckoff 区间放量突破",
    description:
      `仅使用信号 K 线之前 ${strategy.rangeLookback} 根构造交易区间；效率比不高于 ${strategy.maxRangeEfficiency}，` +
      `收盘突破阻力 ${strategy.breakoutBufferPct}% 且量能达到前 ${strategy.volumeLookback} 根均量的 ${strategy.volumeMultiplier} 倍时入场。`,
    warmupBars,
    evaluate(index, position) {
      if (position) {
        if (position.breakoutResistance !== undefined && bars[index].close < position.breakoutResistance) {
          return {
            action: "exit_long",
            index,
            exitReason: "strategy_signal",
            reason: `收盘 ${formatPrice(bars[index].close)} 跌回突破前阻力 ${formatPrice(position.breakoutResistance)} 下方`,
          };
        }
        return null;
      }
      if (index < warmupBars) return null;

      // 区间和量能基准均严格排除当前信号 K 线，防止当根抬高自己的门槛。
      const rangeBars = bars.slice(index - strategy.rangeLookback, index);
      const rangeCloses = rangeBars.map((bar) => bar.close);
      const resistance = Math.max(...rangeBars.map((bar) => bar.high));
      const support = Math.min(...rangeBars.map((bar) => bar.low));
      const rangeEfficiency = efficiencyRatio(rangeCloses);
      const baselineVolume = mean(bars.slice(index - strategy.volumeLookback, index).map((bar) => bar.volume));
      const breakoutPrice = resistance * (1 + strategy.breakoutBufferPct / 100);
      const current = bars[index];

      if (
        resistance <= support ||
        rangeEfficiency > strategy.maxRangeEfficiency ||
        current.close <= breakoutPrice ||
        baselineVolume <= 0 ||
        current.volume < baselineVolume * strategy.volumeMultiplier
      ) {
        return null;
      }

      return {
        action: "enter_long",
        index,
        breakoutResistance: resistance,
        reason:
          `收盘 ${formatPrice(current.close)} 突破区间阻力 ${formatPrice(resistance)}；` +
          `区间效率比 ${round(rangeEfficiency, 3)}，量能为前均量 ${round(current.volume / baselineVolume, 2)} 倍`,
      };
    },
  };
}

function computeMetrics(
  request: BacktestRequest,
  bars: Kline[],
  curve: BacktestResult["curve"],
  trades: BacktestTrade[],
  totalFees: number,
): BacktestMetrics {
  const finalEquity = curve[curve.length - 1].equity;
  const totalReturn = finalEquity / request.initialCapital - 1;
  const benchmarkReturn = bars[bars.length - 1].close / bars[0].close - 1;
  const periodicReturns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const previous = curve[i - 1].equity;
    periodicReturns.push(previous > 0 ? curve[i].equity / previous - 1 : 0);
  }

  const observedPeriods = Math.max(1, bars.length - 1);
  const elapsedYears = elapsedCalendarYears(bars);
  const periodsPerYear = observedPeriods / elapsedYears;
  const canAnnualize = elapsedYears >= 30 / 365.2425 && curve.length >= 2;
  const annualizedReturn = canAnnualize && finalEquity > 0
    ? Math.expm1(Math.log(finalEquity / request.initialCapital) / elapsedYears)
    : null;
  const volatility = stdev(periodicReturns);
  const annualizedVolatility = canAnnualize ? volatility * Math.sqrt(periodsPerYear) : null;
  const sharpe = canAnnualize ? (volatility > 0 ? (mean(periodicReturns) / volatility) * Math.sqrt(periodsPerYear) : 0) : null;
  const winningTrades = trades.filter((trade) => trade.netPnl > 0);
  const losingTrades = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = winningTrades.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = Math.abs(losingTrades.reduce((sum, trade) => sum + trade.netPnl, 0));

  return {
    totalReturnPct: round(totalReturn * 100, 4),
    benchmarkReturnPct: round(benchmarkReturn * 100, 4),
    excessReturnPct: round((totalReturn - benchmarkReturn) * 100, 4),
    annualizedReturnPct: annualizedReturn === null ? null : round(annualizedReturn * 100, 4),
    annualizedVolatilityPct: annualizedVolatility === null ? null : round(annualizedVolatility * 100, 4),
    sharpeRatio: sharpe === null ? null : round(sharpe, 4),
    maxDrawdownPct: round(Math.abs(Math.min(0, ...curve.map((point) => point.drawdownPct))), 4),
    tradeCount: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRatePct: round(trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0, 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : null,
    averageTradePct: round(trades.length > 0 ? mean(trades.map((trade) => trade.returnPct)) : 0, 4),
    averageHoldingBars: round(trades.length > 0 ? mean(trades.map((trade) => trade.holdingBars)) : 0, 2),
    exposurePct: round((trades.reduce((sum, trade) => sum + trade.holdingBars, 0) / bars.length) * 100, 2),
    totalFees: round(totalFees, 2),
  };
}

function adverseFillPrice(rawPrice: number, side: "buy" | "sell", slippageRate: number): number {
  return rawPrice * (side === "buy" ? 1 + slippageRate : 1 - slippageRate);
}

function elapsedCalendarYears(bars: Kline[]): number {
  const averageYearMs = 365.2425 * 86_400_000;
  const elapsedMs = bars[bars.length - 1].timestamp - bars[0].timestamp;
  // 输入至少包含策略预热所需的多根严格递增 K 线；下限只保护极短分钟样本的除零边界。
  return Math.max(elapsedMs / averageYearMs, 1 / (365.2425 * 24 * 60));
}

function isMainlandAshare(symbol: string): boolean {
  return /\.(?:SH|SZ|BJ)$/i.test(symbol);
}

function fingerprintBars(bars: Kline[]): string {
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (const bar of bars) {
    const encoded = `${bar.timestamp}|${bar.open}|${bar.high}|${bar.low}|${bar.close}|${bar.volume}|${bar.amount};`;
    for (let i = 0; i < encoded.length; i++) {
      const code = encoded.charCodeAt(i);
      left = Math.imul(left ^ code, 0x01000193);
      right = Math.imul(right ^ code, 0x85ebca6b);
    }
  }
  return `ohlcv-v1:${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0).toString(16).padStart(8, "0")}`;
}

function assertFiniteOutput(
  metrics: BacktestMetrics,
  curve: BacktestResult["curve"],
  trades: BacktestTrade[],
): void {
  const metricValues = Object.values(metrics).filter((value): value is number => value !== null);
  const curveValues = curve.flatMap((point) => [point.timestamp, point.equity, point.benchmarkEquity, point.drawdownPct]);
  const tradeValues = trades.flatMap((trade) => [
    trade.entrySignalTime,
    trade.entryTime,
    trade.entryPrice,
    trade.exitTime,
    trade.exitPrice,
    trade.quantity,
    trade.grossPnl,
    trade.netPnl,
    trade.returnPct,
    trade.fees,
    trade.holdingBars,
  ]);
  if (![...metricValues, ...curveValues, ...tradeValues].every(Number.isFinite)) {
    throw new BacktestInputError("INVALID_DATA", "行情数值导致资金或统计结果溢出，无法生成可序列化的回测结果");
  }
}

function createRunId(createdAt: number): string {
  return `bt_${createdAt.toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatPrice(value: number): string {
  return value.toFixed(Math.abs(value) >= 100 ? 2 : 4).replace(/\.?0+$/, "");
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
