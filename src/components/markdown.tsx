"use client";

import {
  Children,
  isValidElement,
  memo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";

function getLanguage(children: ReactNode): string {
  const arr = Children.toArray(children);
  for (const child of arr) {
    if (isValidElement(child)) {
      const props = child.props as { className?: string };
      const cls = props.className;
      if (typeof cls === "string") {
        const m = /language-([\w-]+)/.exec(cls);
        if (m) return m[1];
      }
    }
  }
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const lang = getLanguage(children);

  const copy = () => {
    const text = preRef.current?.innerText ?? "";
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="code-block">
      {lang && <span className="lang-badge">{lang}</span>}
      <button type="button" className="copy-btn" onClick={copy}>
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Скопировано" : "Копировать"}
      </button>
      <pre ref={preRef}>{children}</pre>
    </div>
  );
}

const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          code: ({ className, children }) => {
            const cls = className || "";
            const isBlock =
              /language-|hljs/.test(cls) || String(children).includes("\n");
            if (isBlock) return <code className={cls}>{children}</code>;
            return <code className="inline-code">{children}</code>;
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});

export default Markdown;
