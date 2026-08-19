"use client";

import { useRef, useState } from "react";
import { ImagePlus, Send, Square, X } from "lucide-react";

async function imageToDataUrl(file: File, maxDim = 1280): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        const mime =
          file.type === "image/png" || file.type === "image/webp"
            ? "image/png"
            : "image/jpeg";
        resolve(canvas.toDataURL(mime, 0.85));
      };
      img.onerror = () => resolve(src);
      img.src = src;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export default function Composer({
  input,
  onInputChange,
  attachments,
  onAddImages,
  onRemoveImage,
  onSend,
  onStop,
  streaming,
}: {
  input: string;
  onInputChange: (v: string) => void;
  attachments: string[];
  onAddImages: (urls: string[]) => void;
  onRemoveImage: (index: number) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const canSend = (input.trim().length > 0 || attachments.length > 0) && !streaming;

  const processFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    const room = Math.max(0, 8 - attachments.length);
    const selected = list.slice(0, room);
    if (selected.length === 0) return;
    const urls: string[] = [];
    for (const f of selected) {
      const url = await imageToDataUrl(f);
      if (url) urls.push(url);
    }
    if (urls.length) onAddImages(urls);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (canSend) onSend();
    }
  };

  const autoResize = () => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 180) + "px";
  };

  return (
    <div
      className={`rounded-2xl border bg-[#0f121b]/90 backdrop-blur-md transition-colors ${
        dragOver ? "border-indigo-400/60" : "border-white/10"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files?.length) processFiles(e.dataTransfer.files);
      }}
    >
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-white/[0.06] px-3 pt-3">
          {attachments.map((img, i) => (
            <div key={i} className="group relative">
              <img
                src={img}
                alt={`preview-${i}`}
                className="h-16 w-16 rounded-xl border border-white/10 object-cover"
              />
              <button
                type="button"
                onClick={() => onRemoveImage(i)}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-slate-200 shadow transition hover:bg-red-500"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-2.5">
        <button
          type="button"
          title="Прикрепить изображение"
          onClick={() => fileRef.current?.click()}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/5 hover:text-indigo-300"
        >
          <ImagePlus size={20} />
        </button>

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) processFiles(e.target.files);
            e.target.value = "";
          }}
        />

        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => {
            onInputChange(e.target.value);
            autoResize();
          }}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.files ?? []);
            if (files.length) {
              e.preventDefault();
              processFiles(files);
            }
          }}
          rows={1}
          placeholder="Напишите сообщение… (Shift+Enter — новая строка)"
          className="max-h-45 min-h-10 flex-1 resize-none bg-transparent px-1 py-2 text-[15px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
        />

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            title="Остановить"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/90 text-white shadow-lg shadow-rose-900/30 transition hover:bg-rose-500"
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onSend}
            disabled={!canSend}
            title="Отправить"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-900/40 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
