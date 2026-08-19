"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Menu, Plus, SlidersHorizontal } from "lucide-react";
import type { ConversationSummary, StreamEvent, UIMessage } from "@/lib/types";
import type { ModelInfo } from "@/lib/ai/models";
import Sidebar from "./sidebar";
import MessageBubble from "./message-bubble";
import Composer from "./composer";
import ModelSelect from "./model-select";
import EmptyState from "./empty-state";
import PromptModal from "./prompt-modal";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

const now = () =>
  new Date().toLocaleTimeString("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
  });

type HistoryItem = { role: "user" | "assistant"; content: string };

// Clean history before sending to server — crucial fix for "stops after 2 messages"
function prepareHistory(messages: UIMessage[]): HistoryItem[] {
  const filtered = messages.filter(
    (m) =>
      (m.role === "user" || m.role === "assistant") &&
      typeof m.content === "string" &&
      m.content.trim().length > 0 &&
      !m.error, // drop failed/errored assistant bubbles so next request isn't poisoned
  );
  const out: HistoryItem[] = [];
  for (const m of filtered) {
    const cur = m.content.trim().slice(0, 8000);
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) {
      prev.content = (prev.content + "\n\n" + cur).slice(-8000);
    } else {
      out.push({ role: m.role, content: cur });
    }
  }
  if (out.length && out[0].role === "assistant") out.shift();
  return out.slice(-30);
}

export default function Chat() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModel, setSelectedModel] = useState("deepseek-v4-flash");
  const [webSearch, setWebSearch] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string | undefined>(undefined);
  const [promptModalOpen, setPromptModalOpen] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  const visionAvailable = models.some((m) => m.vision);
  const activeConv = conversations.find((c) => c.id === activeId);
  const activeTitle = activeConv?.title;

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/models");
        const data = await res.json();
        if (Array.isArray(data.models) && data.models.length) {
          setModels(data.models);
          setSelectedModel((prev) =>
            data.models.some((m: ModelInfo) => m.id === prev)
              ? prev
              : data.models[0].id,
          );
        }
      } catch {
        /* ignore */
      }
      try {
        const res = await fetch("/api/conversations");
        const data = await res.json();
        if (Array.isArray(data.conversations)) {
          setConversations(data.conversations);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/conversations");
      const data = await res.json();
      if (Array.isArray(data.conversations)) {
        setConversations(data.conversations);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      if (streamingRef.current) abortRef.current?.abort();
      try {
        const res = await fetch(`/api/conversations/${id}`);
        if (!res.ok) return;
        const data = await res.json();
        setActiveId(id);
        setSystemPrompt(data.conversation?.systemPrompt ?? undefined);
        const msgs: UIMessage[] = (data.messages ?? [])
          .filter(
            (m: { role?: string }) => m.role === "user" || m.role === "assistant",
          )
          .map(
            (m: {
              id: string;
              role: "user" | "assistant";
              content: string;
              images?: string[];
              reasoning?: string;
              model?: string;
              createdAt?: string;
            }) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              images: m.images ?? [],
              reasoning: m.reasoning,
              model: m.model,
              time: m.createdAt
                ? new Date(m.createdAt).toLocaleTimeString("ru-RU", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : undefined,
            }),
          );
        setMessages(msgs);
        if (
          data.conversation?.model &&
          models.some((m) => m.id === data.conversation.model)
        ) {
          setSelectedModel(data.conversation.model);
        }
      } catch {
        /* ignore */
      }
    },
    [models],
  );

  const newChat = useCallback(() => {
    if (streamingRef.current) abortRef.current?.abort();
    setActiveId(null);
    setMessages([]);
    setInput("");
    setAttachments([]);
    setSystemPrompt(undefined);
    setStreaming(false);
    streamingRef.current = false;
  }, []);

  const handleSaveSystemPrompt = useCallback(
    async (newPrompt: string) => {
      setSystemPrompt(newPrompt);
      if (activeId) {
        try {
          await fetch(`/api/conversations/${activeId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ systemPrompt: newPrompt }),
          });
          setConversations((prev) =>
            prev.map((c) =>
              c.id === activeId ? { ...c, systemPrompt: newPrompt } : c,
            ),
          );
        } catch {
          /* ignore */
        }
      }
    },
    [activeId],
  );

  const runCompletion = useCallback(
    async (opts: {
      userText: string;
      images: string[];
      history: HistoryItem[];
      prependUser: boolean;
      regenerate: boolean;
    }) => {
      if (streamingRef.current) return;

      const userMsg: UIMessage = {
        id: uid(),
        role: "user",
        content: opts.userText,
        images: opts.images,
        time: now(),
      };
      const assistantMsg: UIMessage = {
        id: uid(),
        role: "assistant",
        content: "",
        images: [],
        reasoning: "",
        streaming: true,
        model: selectedModel,
        time: now(),
      };

      setMessages((prev) =>
        opts.prependUser ? [...prev, userMsg, assistantMsg] : [...prev, assistantMsg],
      );
      setStreaming(true);
      streamingRef.current = true;

      const controller = new AbortController();
      abortRef.current = controller;

      let textBuf = "";
      let reasoningBuf = "";
      let errorMsg: string | undefined;
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let receivedAny = false;

      const flush = () => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? { ...m, reasoning: reasoningBuf || undefined, content: textBuf }
              : m,
          ),
        );
      };
      const scheduleFlush = () => {
        if (flushTimer) return;
        flushTimer = setTimeout(() => {
          flush();
          flushTimer = null;
        }, 35);
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: activeIdRef.current,
            model: selectedModel,
            history: opts.history,
            userText: opts.userText,
            images: opts.images,
            webSearch,
            systemPrompt,
            regenerate: opts.regenerate,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.error || `Ошибка ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const processLine = (rawLine: string) => {
          const t = rawLine.trim();
          if (!t) return;
          if (t.startsWith(":")) return; // SSE keepalive ping
          if (!t.startsWith("data:")) return;
          const payload = t.slice(5).trim();
          if (!payload || payload === "[DONE]") return;
          let ev: StreamEvent;
          try {
            ev = JSON.parse(payload);
          } catch {
            return;
          }

          receivedAny = true;
          if (ev.type === "meta") {
            if (ev.conversationId && ev.conversationId !== activeIdRef.current) {
              setActiveId(ev.conversationId);
              activeIdRef.current = ev.conversationId;
            }
            if (ev.model) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id ? { ...m, model: ev.model } : m,
                ),
              );
            }
          } else if (ev.type === "reasoning") {
            reasoningBuf += ev.delta;
            scheduleFlush();
          } else if (ev.type === "text") {
            textBuf += ev.delta;
            scheduleFlush();
          } else if (ev.type === "done") {
            // stream finished successfully — nothing to do, loop will end
          } else if (ev.type === "error") {
            throw new Error(ev.message);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Robust SSE parsing: split on \n, but handle \n\n boundaries
          // Keep incomplete line in buffer
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            processLine(line);
          }
        }
        // process any trailing buffered line that didn't end with \n
        if (buffer.trim()) processLine(buffer);

        // If stream ended without any event (proxy closed), treat as error
        if (!receivedAny && !textBuf.trim() && !reasoningBuf.trim() && !controller.signal.aborted) {
          throw new Error("Соединение прервано до получения ответа. Попробуйте ещё раз.");
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          errorMsg = err instanceof Error ? err.message : "Неизвестная ошибка";
        }
      } finally {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        // Ensure latest content is flushed synchronously before marking done
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  reasoning: reasoningBuf || undefined,
                  content: textBuf,
                  error:
                    errorMsg ||
                    (textBuf.trim()
                      ? undefined
                      : "Модель вернула пустой ответ. Подождите пару секунд и нажмите «Повторить» — бесплатные модели иногда перегружены."),
                  streaming: false,
                  model: selectedModel,
                }
              : m,
          ),
        );
        setStreaming(false);
        streamingRef.current = false;
        abortRef.current = null;
        loadConversations();
      }
    },
    [selectedModel, webSearch, systemPrompt, loadConversations],
  );

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || streamingRef.current) return;
    const history = prepareHistory(messages);
    runCompletion({
      userText: text,
      images: attachments,
      history,
      prependUser: true,
      regenerate: false,
    });
    setInput("");
    setAttachments([]);
  }, [input, attachments, messages, runCompletion]);

  const sendSuggestion = useCallback(
    (text: string) => {
      if (streamingRef.current) return;
      const history = prepareHistory(messages);
      runCompletion({
        userText: text,
        images: [],
        history,
        prependUser: true,
        regenerate: false,
      });
    },
    [messages, runCompletion],
  );

  const regenerate = useCallback(() => {
    if (streamingRef.current) return;
    let lastUserIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        lastUserIdx = i;
        break;
      }
    }
    if (lastUserIdx < 0) return;
    const lastUser = messages[lastUserIdx];
    const history = prepareHistory(messages.slice(0, lastUserIdx));
    setMessages(messages.slice(0, lastUserIdx));
    runCompletion({
      userText: lastUser.content,
      images: lastUser.images,
      history,
      prependUser: true,
      regenerate: true,
    });
  }, [messages, runCompletion]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const deleteConversation = useCallback(
    async (id: string) => {
      try {
        await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      } catch {
        /* ignore */
      }
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeId === id) newChat();
    },
    [activeId, newChat],
  );

  const renameConversation = useCallback(async (id: string, title: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c)),
    );
    try {
      await fetch(`/api/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch {
      /* ignore */
    }
  }, []);

  const addImages = useCallback((urls: string[]) => {
    setAttachments((prev) => [...prev, ...urls].slice(0, 8));
  }, []);

  const removeImage = useCallback((i: number) => {
    setAttachments((prev) => prev.filter((_, idx) => idx !== i));
  }, []);

  const hasCustomPrompt = Boolean(systemPrompt?.trim());

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        onSelect={openConversation}
        onNew={newChat}
        onDelete={deleteConversation}
        onRename={renameConversation}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header with high z-index to avoid dropdown clipping */}
        <header className="relative z-30 flex items-center gap-2 border-b border-white/[0.06] bg-[#0b0d14]/80 px-3 py-2.5 backdrop-blur-md sm:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 lg:hidden"
          >
            <Menu size={20} />
          </button>

          <div className="min-w-0 flex-1 sm:flex-initial">
            <div className="truncate text-sm font-semibold text-slate-200">
              {activeTitle || "Новый чат"}
            </div>
            <div className="hidden text-[11px] text-slate-500 sm:block">
              {streaming ? "Печатает…" : "Hermess AI"}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* System Prompt Button */}
            <button
              type="button"
              onClick={() => setPromptModalOpen(true)}
              title="Настроить системный промпт"
              className={`relative flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium transition ${
                hasCustomPrompt
                  ? "border-purple-500/50 bg-purple-500/15 text-purple-200"
                  : "border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10"
              }`}
            >
              <SlidersHorizontal size={14} className="text-purple-400" />
              <span className="hidden sm:inline">Промпт</span>
              {hasCustomPrompt && (
                <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
              )}
            </button>

            {/* Web Search Toggle */}
            <button
              type="button"
              onClick={() => setWebSearch((v) => !v)}
              title="Веб-поиск (Wikipedia)"
              className={`flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition ${
                webSearch
                  ? "border-indigo-400/50 bg-indigo-500/20 text-indigo-200"
                  : "border-white/10 bg-white/5 text-slate-400 hover:border-white/20 hover:bg-white/10"
              }`}
            >
              <Globe size={15} />
              <span className="hidden sm:inline">Поиск</span>
            </button>

            {/* Model Selector */}
            {models.length > 0 ? (
              <ModelSelect
                models={models}
                value={selectedModel}
                onChange={setSelectedModel}
              />
            ) : (
              <div className="h-9 w-32 animate-pulse rounded-xl border border-white/10 bg-white/5" />
            )}

            {/* New Chat Button */}
            <button
              type="button"
              onClick={newChat}
              title="Новый чат"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-300 transition hover:border-white/20 hover:bg-white/10"
            >
              <Plus size={17} />
            </button>
          </div>
        </header>

        {/* Chat History Main */}
        <main ref={scrollRef} className="scrollbar-thin flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <div className="flex h-full items-center">
              <EmptyState
                onSuggestion={sendSuggestion}
                onOpenPromptModal={() => setPromptModalOpen(true)}
                visionAvailable={visionAvailable}
              />
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
              {messages.map((m, i) => {
                const isLast = i === messages.length - 1 && m.role === "assistant";
                return (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    isLast={isLast}
                    onRegenerate={isLast ? regenerate : undefined}
                  />
                );
              })}
              <div className="h-1" />
            </div>
          )}
        </main>

        {/* Bottom Composer */}
        <footer className="px-3 pb-3 pt-2 sm:px-4">
          <div className="mx-auto max-w-3xl">
            <Composer
              input={input}
              onInputChange={setInput}
              attachments={attachments}
              onAddImages={addImages}
              onRemoveImage={removeImage}
              onSend={sendMessage}
              onStop={stop}
              streaming={streaming}
            />
            <p className="mt-1.5 text-center text-[11px] text-slate-600">
              Hermess может допускать неточности — проверяйте важные факты.
            </p>
          </div>
        </footer>
      </div>

      {/* System Prompt Editor Modal */}
      <PromptModal
        isOpen={promptModalOpen}
        onClose={() => setPromptModalOpen(false)}
        currentPrompt={systemPrompt}
        onSave={handleSaveSystemPrompt}
      />
    </div>
  );
}
