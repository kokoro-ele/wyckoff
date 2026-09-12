import type { Kline } from "@wyckoff/shared";

export type { Kline };

/** ZigZag 识别出的摆动高低点。 */
export interface SwingPoint {
  index: number;
  timestamp: number;
  price: number;
  type: "high" | "low";
  /** 相对上一个反向摆动点的价格变动百分比。 */
  changePct: number;
  /** 该摆动腿跨越的 K 线根数。 */
  bars: number;
}

/** 单根 K 线的量价（VSA）特征。 */
export interface BarFeature {
  index: number;
  timestamp: number;
  /** 价差（最高-最低）相对近期均值的倍数。 */
  spreadRatio: number;
  /** 收盘价在当根 K 线内的相对位置，0=收在最低，1=收在最高。 */
  closePosition: number;
  /** 实体占价差的比例。 */
  bodyRatio: number;
  /** 成交量相对近期均值的倍数。 */
  volumeRatio: number;
  /** 相对前收的涨跌幅（%）。 */
  changePct: number;
  isWideSpread: boolean;
  isNarrowSpread: boolean;
  isClimacticVolume: boolean;
  isVolumeDryUp: boolean;
  /**
   * 努力与结果法则的判定：
   * - `no_result` 放大量却没走出幅度，是转折的预警
   * - `no_effort` 无量却走出大幅度，说明该方向缺乏承接
   */
  effortVsResult: "aligned" | "no_result" | "no_effort";
}

/** 值得单独拿给 Agent 看的异常 K 线。 */
export interface NotableBar extends BarFeature {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 该 K 线为什么值得注意，人类可读。 */
  reasons: string[];
}

/** 交易区间内检测到的边界穿刺行为。 */
export interface RangePierce {
  index: number;
  timestamp: number;
  side: "below" | "above";
  /** 穿刺深度占区间高度的比例。 */
  depthPct: number;
  /** 是否在同根 K 线内收回区间内部（Spring / Upthrust 的形态前提）。 */
  recovered: boolean;
  /** 穿刺当根的量比。 */
  volumeRatio: number;
}

/** 横盘交易区间——Wyckoff 分析的骨架。 */
export interface TradingRange {
  startIndex: number;
  endIndex: number;
  startTime: number;
  endTime: number;
  bars: number;
  support: number;
  resistance: number;
  /** 区间高度占中价的百分比。 */
  heightPct: number;
  /** 效率比，越低说明越震荡。 */
  efficiencyRatio: number;
  /** 触及上下沿的次数。 */
  touchesTop: number;
  touchesBottom: number;
  /** 区间内均量相对区间前均量的倍数。 */
  volumeVsBefore: number;
  /** 进入区间前的价格方向，决定这是潜在吸筹还是潜在派发。 */
  priorTrend: "up" | "down" | "flat";
  /** 基于 priorTrend 的初步倾向，最终定性交给 Agent。 */
  hypothesis: "accumulation" | "distribution" | "unclear";
  pierces: RangePierce[];
  /** 该段的平均 ATR，用于衡量区间高度是否具有结构意义。 */
  atrAtRange: number;
}

export interface TrendSummary {
  /** 收盘价对 MA 的位置与 MA 斜率共同决定。 */
  shortTerm: "up" | "down" | "flat";
  mediumTerm: "up" | "down" | "flat";
  longTerm: "up" | "down" | "flat";
  ma20: number;
  ma50: number;
  ma200: number;
}

export interface RelativeStrength {
  benchmark: string;
  /** 标的涨跌幅减去基准涨跌幅（百分点）。 */
  excessReturnPct: number;
  outperforming: boolean;
  lookbackBars: number;
}

export interface MarketFeatures {
  /** 计算本快照所用的引擎版本、参数与固定判据，供 UI、日志和回测复现。 */
  engine: FeatureEngineMetadata;
  symbol: string;
  period: string;
  barCount: number;
  startTime: number;
  endTime: number;
  price: {
    first: number;
    last: number;
    min: number;
    max: number;
    /** 跨整个加载窗口的涨跌幅（%），长图上代表总历史变动而非近期动量。 */
    changePct: number;
    /** 最近 60 根的涨跌幅（%），反映近期动量。 */
    recentChangePct: number;
  };
  atr: {
    current: number;
    /** ATR 占收盘价的百分比，衡量波动水平。 */
    currentPct: number;
  };
  volume: {
    mean: number;
    last: number;
    /** 最近 10 根均量相对此前均量的倍数（基准不含最近 10 根，避免自身抬高基准）。 */
    recentRatio: number;
  };
  trend: TrendSummary;
  swings: SwingPoint[];
  tradingRanges: TradingRange[];
  notableBars: NotableBar[];
  relativeStrength?: RelativeStrength;
}

export interface FeatureOptions {
  /** ZigZag 阈值 = swingAtrMultiple × ATR。越大摆动点越少越显著。 */
  swingAtrMultiple?: number;
  atrPeriod?: number;
  /** 构成一个交易区间所需的最少 K 线数。 */
  minRangeBars?: number;
  /** 效率比的上限，作为聚簇判据之外的兜底，防止把缓慢爬升也算作横盘。 */
  maxRangeEfficiency?: number;
  /** 最多返回多少根异常 K 线。 */
  maxNotableBars?: number;
  /** 量价统计的回看窗口。 */
  lookback?: number;
}

export interface FeatureEngineMetadata {
  version: string;
  options: Required<FeatureOptions>;
  thresholds: {
    climaxVolumeRatio: number;
    dryUpVolumeRatio: number;
    wideSpreadRatio: number;
    narrowSpreadRatio: number;
    rangeSwingAtrMultiple: number;
    clusterToleranceOfHeight: number;
    minRangeHeightAtr: number;
    maxRangeHeightAtr: number;
    minPierceDepthOfHeight: number;
    touchBandOfHeight: number;
  };
}

export const DEFAULT_FEATURE_OPTIONS: Required<FeatureOptions> = {
  swingAtrMultiple: 2.5,
  atrPeriod: 14,
  minRangeBars: 20,
  maxRangeEfficiency: 0.5,
  maxNotableBars: 40,
  lookback: 20,
};

export const FEATURE_ENGINE_VERSION = "1.1.0";

export const FEATURE_THRESHOLDS: FeatureEngineMetadata["thresholds"] = {
  climaxVolumeRatio: 2.2,
  dryUpVolumeRatio: 0.6,
  wideSpreadRatio: 1.6,
  narrowSpreadRatio: 0.6,
  rangeSwingAtrMultiple: 1.2,
  clusterToleranceOfHeight: 0.35,
  minRangeHeightAtr: 1.2,
  maxRangeHeightAtr: 14,
  minPierceDepthOfHeight: 0.08,
  touchBandOfHeight: 0.15,
};
