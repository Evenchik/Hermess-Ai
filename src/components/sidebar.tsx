"use client";

import { useState } from "react";
import { MessageSquare, Pencil, Plus, Sparkles, Trash2, X } from "lucide-react";
import type { ConversationSummary } from "@/lib/types";

function relativeTime(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Date.now() - d;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "только что";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days} дн.`;
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  });
}

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  open,
  onClose,
}: {
  conversations: ConversationSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (c: ConversationSummary) => {
    setEditingId(c.id);
    setEditValue(c.title);
  };

  const commitEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-white/[0.07] bg-[#0b0d14]/95 backdrop-blur-xl transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0 lg:bg-[#0b0d14] ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pb-2 pt-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shadow-md shadow-indigo-900/40">
              <Sparkles size={18} className="text-white" />
            </div>
            <div>
              <span className="text-base font-bold tracking-tight text-white">Hermess</span>
              <span className="ml-1.5 rounded-md bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                AI
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-3 pb-2 pt-2">
          <button
            type="button"
            onClick={() => {
              onNew();
              onClose();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 transition hover:brightness-110"
          >
            <Plus size={16} />
            Новый чат
          </button>
        </div>

        <div className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 py-1">
          {conversations.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-slate-600">
              Пока нет диалогов
            </p>
          )}

          {conversations.map((c) => {
            const isActive = c.id === activeId;
            return (
              <div
                key={c.id}
                className={`group flex items-center gap-2 rounded-xl px-2.5 py-2 transition ${
                  isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                }`}
              >
                <MessageSquare
                  size={15}
                  className={`shrink-0 ${isActive ? "text-indigo-300" : "text-slate-600"}`}
                />
                <button
                  type="button"
                  onClick={() => {
                    onSelect(c.id);
                    onClose();
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  {editingId === c.id ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEdit();
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="w-full rounded-md border border-indigo-400/40 bg-transparent px-1.5 py-0.5 text-sm text-white outline-none"
                    />
                  ) : (
                    <div className="flex flex-col">
                      <span
                        className={`truncate text-sm font-medium ${
                          isActive ? "text-white" : "text-slate-300"
                        }`}
                      >
                        {c.title}
                      </span>
                      <span className="text-[10px] text-slate-600">
                        {relativeTime(c.updatedAt)}
                      </span>
                    </div>
                  )}
                </button>

                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition group-hover:opacity-100">
                  <button
                    type="button"
                    title="Переименовать"
                    onClick={() => startEdit(c)}
                    className="rounded-md p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    title="Удалить"
                    onClick={() => onDelete(c.id)}
                    className="rounded-md p-1 text-slate-500 transition hover:bg-red-500/20 hover:text-red-300"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="border-t border-white/[0.06] px-4 py-3 text-[11px] leading-relaxed text-slate-500">
          Бесплатные модели <span className="text-slate-300 font-semibold">DeepSeek V4</span> и{" "}
          <span className="text-slate-300 font-semibold">GPT-OSS</span> работают без ключа. Для GPT-4o и Claude подключите API-ключи в окружение.
        </div>
      </aside>
    </>
  );
}
