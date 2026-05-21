'use client';

import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h2 className="mt-3 first:mt-0 text-[13px] font-semibold tracking-tight text-foreground">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="mt-3 first:mt-0 text-[12px] font-semibold tracking-tight text-foreground">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-2 text-[12px] font-semibold text-foreground">{children}</h4>
  ),
  p: ({ children }) => <p className="my-1.5 text-[12px] leading-relaxed text-foreground first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-1.5 ml-4 list-disc space-y-0.5 text-[12px] text-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-1.5 ml-4 list-decimal space-y-0.5 text-[12px] text-foreground">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed [&>p]:my-0">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic text-foreground">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-primary/40 pl-2 text-[11px] text-muted-foreground">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 max-w-full overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[12rem] border-collapse text-[11px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border last:border-b-0">{children}</tr>,
  th: ({ children }) => (
    <th className="border border-border px-2 py-1.5 text-left font-semibold text-foreground">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1.5 align-top text-foreground">{children}</td>
  ),
  hr: () => <hr className="my-3 border-border" />,
  a: ({ href, children }) => (
    <a href={href} className="text-primary underline underline-offset-2 hover:text-primary/90" target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-muted/80 p-2 font-mono text-[11px] text-foreground">{children}</pre>
  ),
  code: ({ className, children }) => {
    const isInline = !className;
    if (isInline) {
      return <code className="rounded bg-muted/80 px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>;
    }
    return <code className="block font-mono text-[11px] text-foreground">{children}</code>;
  },
};

export function CopilotAssistantMarkdown(props: { content: string }) {
  return (
    <div className="copilot-assistant-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {props.content}
      </ReactMarkdown>
    </div>
  );
}
