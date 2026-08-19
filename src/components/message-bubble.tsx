"use client";

import { useState } from "react";
import {
  AlertCircle,
  Brain,
  Check,
  ChevronRight,
  Copy,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { UIMessage } from "@/lib/types";
import { modelLabel } from "@/lib/ai/models";
import Markdown from "./markdown";

function Thinking({ text }: { text: string }) {
  return (
    <details className="thinking" open>
      <summary>
        <ChevronRight size={14} className="chev" />
        <Brain size={14} />
        Рассуждения
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
}

function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition ${
        className ??
        "text-slate-500 hover:bg-white/5 hover:text-slate-200"
      }`}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? "Скопировано" : label}
    </button>
  );
}

export default function MessageBubble({
  message,
  isLast,
  onRegenerate,
}: {
  message: UIMessage;
  isLast: boolean;
  onRegenerate?: () => void;
}) {
  if (message.role === "user") {
    return (
      <div className="group flex flex-col items-end animate-fade-up">
        <div className="flex max-w-[82%] flex-col items-end">
          {message.images.length > 0 && (
            <div className="mb-2 flex flex-wrap justify-end gap-2">
              {message.images.map((img, i) => (
                <a key={i} href={img} target="_blank" rel="noreferrer">
                  <img
                    src={img}
                    alt={`attachment-${i}`}
                    className="h-28 w-28 rounded-xl border border-white/10 object-cover shadow-lg transition hover:scale-[1.03]"
                  />
                </a>
              ))}
            </div>
          )}
          {message.content && (
            <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-br from-indigo-600 to-violet-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-lg shadow-indigo-900/30">
              {message.content}
            </div>
          )}
        </div>

        {/* Copy action for the user's own message */}
        <div className="mt-1 flex items-center gap-2">
          {message.content && (
            <CopyButton
              text={message.content}
              label="Копировать"
              className="text-slate-500 opacity-0 transition hover:bg-white/5 hover:text-slate-200 group-hover:opacity-100"
            />
          )}
          {message.time && (
            <div className="px-1 text-[11px] text-slate-600">{message.time}</div>
          )}
        </div>
      </div>
    );
  }

  const showTyping = message.streaming && !message.content && !message.reasoning;
  const copyText = [message.content, message.reasoning ? `\n\n— Рассуждения —\n${message.reasoning}` : ""]
    .filter(Boolean)
    .join("\n");
  const label = modelLabel(message.model);

  return (
    <div className="group flex gap-3 animate-fade-up">
      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shadow-md shadow-indigo-900/30">
        <Sparkles size={16} className="text-white" />
      </div>

      <div className="min-w-0 max-w-[85%] flex-1">
        <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
          <span className="font-semibold text-slate-200">Hermess</span>
          {label && (
            <span className="rounded-md bg-white/[0.06] px-1.5 py-0.2 text-[10px] text-slate-400">
              {label}
            </span>
          )}
          {message.time && <span>· {message.time}</span>}
        </div>

        {message.reasoning && <Thinking text={message.reasoning} />}

        <div className="rounded-2xl rounded-tl-md border border-white/[0.07] bg-white/[0.03] px-4 py-3">
          {showTyping ? (
            <div className="flex items-center gap-1.5 py-1.5">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          ) : (
            <>
              <Markdown>{message.content}</Markdown>
              {message.streaming && (
                <span className="cursor-blink ml-0.5 inline-block h-4 w-2 translate-y-0.5 rounded-sm bg-indigo-400" />
              )}
            </>
          )}

          {message.error && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{message.error}</span>
            </div>
          )}
        </div>

        {!message.streaming && message.content && (
          <div
            className={`mt-1.5 flex items-center gap-1 transition-opacity ${
              isLast ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <CopyButton text={copyText} label="Копировать" />
            {isLast && onRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
              >
                <RefreshCw size={13} />
                Повторить
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
