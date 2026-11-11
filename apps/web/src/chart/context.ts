/** React uses this identity to detach old candles and quotes in the same commit as the new title. */
export function chartContextKey(context: {
  symbol: string;
  period: string;
  adjust: string;
  timeSpan: string;
  chartRevision: number | string;
}): string {
  return JSON.stringify([context.symbol, context.period, context.adjust, context.timeSpan, context.chartRevision]);
}
