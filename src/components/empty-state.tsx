"use client";

import { Globe, ImagePlus, SlidersHorizontal, Sparkles } from "lucide-react";

const SUGGESTIONS = [
  "Напиши функцию на TypeScript с мемоизацией",
  "Сравни квантовые компьютеры и классические",
  "Составь контент-план для IT-проекта",
  "Придумай 5 перспективных идей для ИИ-стартапа",
];

export default function EmptyState({
  onSuggestion,
  onOpenPromptModal,
  visionAvailable,
}: {
  onSuggestion: (text: string) => void;
  onOpenPromptModal: () => void;
  visionAvailable: boolean;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-10 text-center">
      <div className="relative mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 shadow-xl shadow-indigo-500/30">
        <Sparkles size={32} className="text-white" />
      </div>
      <h2 className="text-3xl font-bold tracking-tight text-white">
        Привет! Я Hermess
      </h2>
      <p className="mt-2 max-w-md text-sm text-slate-400">
        Умный ИИ-ассистент с поддержкой веб-поиска, прикрепления картинок, кода и гибкого системного промпта.
      </p>

      <div className="mt-8 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSuggestion(s)}
            className="group flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3.5 text-left text-sm text-slate-300 transition hover:border-indigo-400/50 hover:bg-white/[0.06] hover:text-white"
          >
            <span className="text-slate-500 transition group-hover:text-indigo-400">
              <Sparkles size={16} />
            </span>
            <span className="line-clamp-2">{s}</span>
          </button>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-400">
        <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
          <Globe size={13} className="text-indigo-400" /> Веб-поиск
        </span>
        <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5">
          <ImagePlus size={13} className="text-purple-400" />
          {visionAvailable ? "Распознавание картинок" : "Прикрепление картинок"}
        </span>
        <button
          type="button"
          onClick={onOpenPromptModal}
          className="flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-indigo-300 transition hover:bg-indigo-500/20"
        >
          <SlidersHorizontal size={13} />
          Настроить системный промпт
        </button>
      </div>
    </div>
  );
}
