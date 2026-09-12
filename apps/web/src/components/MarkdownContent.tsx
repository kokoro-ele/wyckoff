import type { Components } from "react-markdown";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { splitStreamingMarkdown } from "@/lib/streamingMarkdown.js";

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent">
      {children}
    </a>
  ),
  code: ({ className, children, ...props }) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="rounded-[5px] bg-black/35 px-1 py-0.5 font-mono text-[12px] text-accent" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-[10px] border border-line-soft bg-black/35 p-2.5 font-mono text-[12px] leading-relaxed">
      {children}
    </pre>
  ),
  ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-4">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  p: ({ children }) => <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h1 className="mb-1.5 mt-2 text-[15px] font-semibold first:mt-0">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-1.5 mt-2 text-[14px] font-semibold first:mt-0">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 mt-2 text-[13px] font-semibold first:mt-0">{children}</h3>,
  blockquote: ({ children }) => (
    <blockquote className="my-1.5 border-l-2 border-accent/50 pl-2.5 text-ink-dim">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[12px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-line-soft bg-black/25 px-2 py-1 text-left font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-line-soft px-2 py-1">{children}</td>,
  hr: () => <hr className="my-2 border-line-soft" />,
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
};

export function MarkdownContent({ source, streaming = false }: { source: string; streaming?: boolean }) {
  if (!source && streaming) return null;
  if (!source) return <>…</>;

  const { ready, tail } = streaming ? splitStreamingMarkdown(source) : { ready: source, tail: "" };

  return (
    <div className="md-chat">
      {ready ? (
        <Markdown remarkPlugins={[remarkGfm]} components={components}>
          {ready}
        </Markdown>
      ) : null}
      {tail ? <span className="whitespace-pre-wrap text-ink-dim">{tail}</span> : null}
    </div>
  );
}
