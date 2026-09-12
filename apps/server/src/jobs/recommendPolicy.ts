import type { RecommendBookItem } from "@wyckoff/shared";

/** 本轮开始时就在名单里的标的，即使复核出局，也不能在同一轮作为新票重新进入。 */
export function selectEligibleCandidates<T extends { symbol: string }>(
  hits: T[],
  initialSymbols: ReadonlySet<string>,
  currentSymbols: ReadonlySet<string>,
): T[] {
  return hits.filter((hit) => !initialSymbols.has(hit.symbol) && !currentSymbols.has(hit.symbol));
}

export interface CapacityDecision {
  removedExisting: RecommendBookItem[];
  rejectedNew: RecommendBookItem[];
}

/**
 * 容量策略保持原有业务偏好：先比较观察项，再按确信度淘汰；下手项最后淘汰。
 * 新候选若自身排在容量线外，只算未入选，不生成进出历史。
 */
export function chooseCapacityRemovals(
  book: RecommendBookItem[],
  cap: number,
  initialSymbols: ReadonlySet<string>,
): CapacityDecision {
  if (book.length <= cap) return { removedExisting: [], rejectedNew: [] };

  const ranked = [...book].sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket === "enter" ? 1 : -1;
    return a.conviction - b.conviction || b.openedAt - a.openedAt;
  });
  const victims = ranked.slice(0, book.length - cap);
  return {
    removedExisting: victims.filter((item) => initialSymbols.has(item.symbol)),
    rejectedNew: victims.filter((item) => !initialSymbols.has(item.symbol)),
  };
}

export function rotationExitPrice(item: RecommendBookItem): number {
  return item.lastPrice ?? item.entryPrice;
}
