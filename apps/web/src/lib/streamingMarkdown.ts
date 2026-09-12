/**
 * Peel incomplete trailing Markdown so a streaming parse does not flicker
 * (unclosed ** / ` / ``` / [link]( ).
 */
export function splitStreamingMarkdown(text: string): { ready: string; tail: string } {
  if (!text) return { ready: "", tail: "" };

  const fenceCount = countToken(text, "```");
  if (fenceCount % 2 === 1) {
    const last = text.lastIndexOf("```");
    return { ready: text.slice(0, last), tail: text.slice(last) };
  }

  const incompleteLink = text.search(/\[[^\]]*\]\([^)]*$/);
  if (incompleteLink >= 0) {
    return { ready: text.slice(0, incompleteLink), tail: text.slice(incompleteLink) };
  }

  if (countToken(text, "**") % 2 === 1) {
    const last = text.lastIndexOf("**");
    return { ready: text.slice(0, last), tail: text.slice(last) };
  }

  const lastBacktick = text.lastIndexOf("`");
  if (lastBacktick >= 0 && countToken(text, "`") % 2 === 1) {
    return { ready: text.slice(0, lastBacktick), tail: text.slice(lastBacktick) };
  }

  if (countToken(text, "*") % 2 === 1) {
    const last = text.lastIndexOf("*");
    if (last >= 0 && text[last - 1] !== "*") {
      return { ready: text.slice(0, last), tail: text.slice(last) };
    }
  }

  return { ready: text, tail: "" };
}

function countToken(text: string, token: string): number {
  let count = 0;
  let from = 0;
  while (from < text.length) {
    const at = text.indexOf(token, from);
    if (at < 0) break;
    count += 1;
    from = at + token.length;
  }
  return count;
}
