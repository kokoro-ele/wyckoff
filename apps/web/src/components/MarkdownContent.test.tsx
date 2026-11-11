import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent.js";
const source = "* 观察量价结构\n\n## 关键结论\n\n| 事件 | 含义 |\n| --- | --- |\n| Spring | 测试支撑 |";
describe("Markdown responses", () => {
  it.each([false, true])("renders lists, headings and tables with streaming=%s", (streaming) => {
    const html = renderToStaticMarkup(<MarkdownContent source={source} streaming={streaming} />);
    expect(html).toContain("<h2");
    expect(html).toContain("<table");
    expect(html).toContain("<th");
    expect(html).toContain("<li");
    expect(html).not.toContain("## 关键结论");
  });
  it("renders complete content before an unfinished fenced block", () => {
    const html = renderToStaticMarkup(<MarkdownContent source={"## 结论\n\n```text\n未完成的代码"} streaming />);
    expect(html).toContain("<h2");
    expect(html).toContain("<pre");
    expect(html).not.toContain("```text");
  });
  it("does not execute HTML or unsafe Markdown links", () => {
    const html = renderToStaticMarkup(<MarkdownContent source={'<script>alert(1)</script>\n\n[链接](javascript:alert(1))'} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain('href="javascript:');
  });
});
