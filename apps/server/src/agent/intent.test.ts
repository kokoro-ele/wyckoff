import { describe, expect, it } from "vitest";
import { detectIntent, planForIntent } from "./intent.js";

describe("agent intent routing", () => {
  it("recognises corrections, trade questions and event checks", () => {
    expect(detectIntent("不对，日期差了一天")).toBe("correction");
    expect(detectIntent("现在适合买吗，止损放哪里")).toBe("trade");
    expect(detectIntent("这根是不是 Spring？")).toBe("event");
    expect(detectIntent("帮我验证一下 8 月 27 日的标注")).toBe("verification");
    expect(detectIntent("这个区间是什么阶段")).toBe("structure");
  });

  it("builds a visible plan in the response language", () => {
    expect(planForIntent("trade", "zh")[0]).toContain("结构");
    expect(planForIntent("trade", "en")[0]).toContain("structure");
  });
});
