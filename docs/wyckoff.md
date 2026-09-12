# Wyckoff method and event catalog

This app reads charts using Richard D. Wyckoff’s market-structure method. Event codes, Chinese names, phases, and descriptions are defined once in [`packages/shared/src/wyckoff-events.ts`](../packages/shared/src/wyckoff-events.ts) (`WYCKOFF_EVENTS`). That object is the source of truth for:

- the Agent system prompt
- chart tag colors (`bullish` / `bearish` / `neutral`)
- which codes `draw_annotations` is allowed to emit

If you add or rename an event, change that file only.

Industry practice: **keep English codes** (SC, Spring, UTAD) in speech and on the chart. Chinese names are for first mention and UI copy.

---

## Composite Man

Treat the tape as one operator — the Composite Man — accumulating in panic and distributing into euphoria. Springs and UTADs are fake breaks meant to flush the other side. The job is to recover **intent** from volume and spread, not to list indicators.

A full cycle:

```
Accumulation → Markup → Distribution → Markdown
```

A trading range inside accumulation or distribution is split into **phases A–E**. Markup / markdown live mostly in phase E, after price has left the range.

---

## Three laws

| Law | Meaning in this app |
|-----|---------------------|
| **Supply and demand** | Demand > supply → price rises; the reverse falls. Read the balance from **spread × volume**. |
| **Cause and effect** | Time and amplitude spent in the range are the **cause**; the move after the break is the **effect**. Larger cause → larger effect. (Point-and-figure counts are not implemented.) |
| **Effort vs result** | Volume is effort; price change is result. Divergence (climax volume + a narrow doji) often precedes a turn. The feature engine flags this as `no_result` / `no_effort`. |

---

## Phases A–E

Defined in `WYCKOFF_PHASES`. Zones on the chart use these letters.

| Phase | Name | What to look for |
|-------|------|------------------|
| **A** | Stopping the prior trend | Exhaustion of selling (or buying). PS/SC/AR/ST or PSY/BC/AR/ST set the first range bounds. |
| **B** | Building the cause | Composite Man accumulates or distributes inside the box. Longest phase: many secondary tests, chop. |
| **C** | The test | Last deceptive break: Spring / Shakeout (accumulation) or UTAD (distribution). |
| **D** | Trend revealed | Demand (or supply) takes over. SOS/LPS or SOW/LPSY. Highest-odds campaign entries. |
| **E** | Out of the range | Markup or markdown underway; the effect starts to pay. |

**How this app decides accumulation vs distribution:** a range after a long decline may be accumulation; after a long advance, distribution. The feature summary’s “prior trend” is a hint, not a verdict. A Spring with no range is meaningless — **range first, then events**.

---

## `WYCKOFF_EVENTS`

Each entry: `code`, `nameEn`, `nameZh`, `side` (`accumulation` \| `distribution` \| `both`), `phases`, `bias`, `description`.

**Bias** drives tag placement: bullish events sit **below** the bar (lows), bearish **above** (highs).

### Accumulation

Typical path: **PS → SC → AR → ST → (B) → Spring / Shakeout → Test → SOS / JAC → LPS / BU → E**.

| Code | EN | 中文 | Phase | Bias | Description |
|------|----|------|-------|------|-------------|
| `PS` | Preliminary Support | 初步支撑 | A | neutral | First notable support on expanding volume/spread in a decline. Large operators start to bid; usually **not** the low. |
| `SC` | Selling Climax | 抛售高潮 | A | bullish | Panic extreme: huge volume, wide spread, close well off the low. Heavy absorption. |
| `ST` | Secondary Test | 二次测试 | A, B | neutral | Return to the climax area. Volume and spread **shrink** vs the climax if selling is spent. |
| `Spring` | Spring | 弹簧 | C | bullish | Brief break of range support, then a fast reclaim. Flushes longs/shorts; the Phase C test. |
| `Shakeout` | Shakeout | 震仓 | C | bullish | A more violent Spring: sharp volume break, then recovery. Same job — shake weak hands. |
| `SOS` | Sign of Strength | 强势信号 | D | bullish | Wide-spread rally on volume through range resistance. Demand in control; Phase D starts. |
| `LPS` | Last Point of Support | 最后支撑点 | D | bullish | Low-volume pullback after SOS with a higher low. Classic low-risk long. |
| `JAC` | Jump Across the Creek | 跳过小溪 | D | bullish | Decisive push over the “creek” (resistance along range highs). Pictorial SOS. |
| `BU` | Back Up to the Edge of the Creek | 回踩溪边 | D | bullish | Pullback after JAC; old resistance becomes support. |

### Distribution

Typical path: **PSY → BC → AR → ST → UT → UTAD → SOW / ICE → LPSY → E**.

| Code | EN | 中文 | Phase | Bias | Description |
|------|----|------|-------|------|-------------|
| `PSY` | Preliminary Supply | 初步供给 | A | neutral | First volume stall in an advance. Distribution starts; the top is not in yet. |
| `BC` | Buying Climax | 购买高潮 | A | bearish | Climactic volume up-bar that **fails to hold**. Composite Man sells into retail FOMO. |
| `UT` | Upthrust | 上冲回落 | B | bearish | Break of range resistance, then an immediate fall back inside. Failed breakout. |
| `UTAD` | Upthrust After Distribution | 派发后上冲 | C | bearish | Last bull trap after the range is built, then a fast failure. Phase C test. |
| `SOW` | Sign of Weakness | 弱势信号 | D | bearish | Wide-spread decline on volume through range support. Supply in control. |
| `LPSY` | Last Point of Supply | 最后供给点 | D | bearish | Weak rally after SOW with a lower high. Low-risk short / exit. |
| `ICE` | Break the Ice | 跌破冰面 | D | bearish | Break of the “ice” (support along range lows), often with a throwback that holds as resistance. |

### Shared (`side: both`)

| Code | EN | 中文 | Phase | Bias | Description |
|------|----|------|-------|------|-------------|
| `AR` | Automatic Rally | 自动反弹 | A | neutral | After a climax, selling (or buying) is exhausted. The **end of AR** is a range boundary: high after SC, low after BC. In distribution the same code is the automatic reaction down. |
| `ST` | Secondary Test | 二次测试 | A, B | neutral | Same code on both sides: test of the climax with shrinking effort. |
| `Test` | Test | 测试 | C, D | neutral | Quiet retest of a prior low (or high). Ideal: low volume, narrow spread, close back in favor. Confirms no supply (or no demand). |

`ST` is listed under both tables in the prompt generator because `side` is `both`.

---

## How the workbench uses this

```
OHLCV → packages/wyckoff (swings, range, VSA)
      → MarketFeatures summary
      → Agent names events using this catalog
      → semantic annotations (event / zone / level / trendline)
      → KLineChart overlays (wyckoffEventTag, wyckoffZone)
```

The model must not invent codes. `draw_annotations` only accepts `WYCKOFF_EVENT_CODES`.

Judging rules the Agent is prompted with:

1. Call `get_features` before calling structure.
2. Identify the **trading range** before Spring / UTAD.
3. Every event needs a tape reason (volume ratio, spread ratio, close location).
4. Prefer “I don’t know” over a forced A–E story.
5. Describe structure and odds, not orders.

---

## Annotation mapping

| Kind | Meaning | Overlay |
|------|---------|---------|
| `event` | One of the codes above, at a bar’s high or low | `wyckoffEventTag` |
| `zone` | Trading range, optional `phase` A–E | `wyckoffZone` |
| `level` | Horizontal (creek, ice, spring low, …) | `horizontalSegment` / `horizontalStraightLine` |
| `trendline` | Creek, ice, demand/supply line | `segment` / `rayLine` |

---

## Not in v1

- Point-and-figure cause-and-effect **counts** (price targets)
- Automatic phase classification (the engine finds ranges and VSA; **naming** is the Agent’s job)
