"use client";

import { useEffect, useRef, useState } from "react";
import { Brain, Check, ChevronDown, Eye, Zap } from "lucide-react";
import type { ModelInfo } from "@/lib/ai/models";

export default function ModelSelect({
  models,
  value,
  onChange,
}: {
  models: ModelInfo[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = models.find((m) => m.id === value) ?? models[0];

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className={`relative ${open ? "z-50" : "z-20"}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/10"
      >
        <span className="flex items-center gap-1.5">
          <Zap size={14} className="text-indigo-400" />
          <span className="max-w-36 truncate font-medium">{current?.label}</span>
        </span>
        <span className="flex items-center gap-1 text-[10px] text-slate-400">
          {current?.vision && (
            <span title="Vision (Анализ изображений)">
              <Eye size={13} />
            </span>
          )}
          {current?.reasoning && (
            <span title="Reasoning (Пошаговые рассуждения)">
              <Brain size={13} />
            </span>
          )}
        </span>
        <ChevronDown
          size={15}
          className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-white/15 bg-[#121522] p-1.5 shadow-2xl shadow-black/90 backdrop-blur-xl">
          <div className="border-b border-white/[0.08] px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Выбор модели
          </div>
          <div className="scrollbar-thin max-h-80 space-y-1 overflow-y-auto pt-1">
            {models.map((m) => {
              const isSelected = m.id === current?.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition ${
                    isSelected
                      ? "border border-indigo-500/40 bg-indigo-500/15 text-white"
                      : "hover:bg-white/5 text-slate-300"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-100">
                        {m.label}
                      </span>
                      <span className="flex items-center gap-1 text-slate-400">
                        {m.vision && (
                          <span title="Vision">
                            <Eye size={12} />
                          </span>
                        )}
                        {m.reasoning && (
                          <span title="Reasoning">
                            <Brain size={12} />
                          </span>
                        )}
                      </span>
                      {!m.requiresKey && (
                        <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-300">
                          Free
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400 line-clamp-2">
                      {m.description}
                    </div>
                  </div>
                  {isSelected && (
                    <Check size={16} className="mt-0.5 shrink-0 text-indigo-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
