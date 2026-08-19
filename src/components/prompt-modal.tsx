"use client";

import { useEffect, useState } from "react";
import {
  Check,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { DEFAULT_SYSTEM_PROMPT, PROMPT_PRESETS } from "@/lib/ai/prompts";

export default function PromptModal({
  isOpen,
  onClose,
  currentPrompt,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  currentPrompt?: string | null;
  onSave: (prompt: string) => void;
}) {
  const [value, setValue] = useState("");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      const initial = currentPrompt?.trim() ? currentPrompt : DEFAULT_SYSTEM_PROMPT;
      setValue(initial);
      const match = PROMPT_PRESETS.find((p) => p.prompt.trim() === initial.trim());
      setSelectedPresetId(match?.id ?? null);
    }
  }, [isOpen, currentPrompt]);

  if (!isOpen) return null;

  const handleSelectPreset = (id: string, promptText: string) => {
    setSelectedPresetId(id);
    setValue(promptText);
  };

  const handleReset = () => {
    setSelectedPresetId("default");
    setValue(DEFAULT_SYSTEM_PROMPT);
  };

  const handleSave = () => {
    onSave(value.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-[#0f121b] shadow-2xl shadow-black/80">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.08] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-900/30">
              <SlidersHorizontal size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Редактор системного промпта</h2>
              <p className="text-xs text-slate-400">
                Задаёт поведение, роль и инструкции для ИИ в этом диалоге
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto p-6">
          {/* Preset Buttons */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Готовые пресеты
              </label>
              <button
                type="button"
                onClick={handleReset}
                className="flex items-center gap-1 text-xs text-indigo-400 transition hover:text-indigo-300"
              >
                <RotateCcw size={12} />
                Сбросить к стандарту
              </button>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PROMPT_PRESETS.map((p) => {
                const isSelected = selectedPresetId === p.id || value.trim() === p.prompt.trim();
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleSelectPreset(p.id, p.prompt)}
                    className={`flex flex-col items-start rounded-2xl border p-3 text-left transition ${
                      isSelected
                        ? "border-indigo-500/60 bg-indigo-500/10 text-white shadow-sm"
                        : "border-white/[0.08] bg-white/[0.02] text-slate-300 hover:border-white/20 hover:bg-white/[0.05]"
                    }`}
                  >
                    <div className="flex w-full items-center justify-between text-xs font-bold text-slate-200">
                      <span>{p.title}</span>
                      {isSelected && <Check size={14} className="text-indigo-400" />}
                    </div>
                    <span className="mt-1 line-clamp-2 text-[11px] text-slate-400">
                      {p.description}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Text Area */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Инструкция (System Prompt)
              </label>
              <span className="text-[11px] text-slate-500">
                {value.length} символов
              </span>
            </div>
            <textarea
              rows={9}
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setSelectedPresetId(null);
              }}
              placeholder="Введите системные инструкции для модели..."
              className="scrollbar-thin w-full rounded-2xl border border-white/10 bg-[#080a10] p-4 text-xs leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-indigo-500/60 focus:outline-none"
            />
          </div>

          <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-3 text-[11px] leading-relaxed text-indigo-300">
            💡 <strong>Совет:</strong> Системный промпт подсказывает Hermess, как форматировать ответы, оформлять формулы KaTeX, писать код и использовать данные веб-поиска.
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-white/[0.08] bg-white/[0.02] px-6 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-xs font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-5 py-2 text-xs font-semibold text-white shadow-lg shadow-indigo-900/30 transition hover:brightness-110"
          >
            <Sparkles size={14} />
            Применить промпт
          </button>
        </div>
      </div>
    </div>
  );
}
