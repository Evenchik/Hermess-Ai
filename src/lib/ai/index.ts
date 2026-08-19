import type { StreamEvent } from "../types";
import { formatSearchContext, webSearch as runWebSearch } from "../search";
import { resolveModel, type ModelInfo, type ProviderId } from "./models";
import { DEFAULT_SYSTEM_PROMPT } from "./prompts";
import {
  anthropicStream,
  freeTierStream,
  groqStream,
  openaiStream,
  type UpstreamMessage,
} from "./providers";

export type ChatRequest = {
  model: string;
  history: { role: "user" | "assistant"; content: string }[];
  userText: string;
  images: string[];
  webSearch: boolean;
  systemPrompt?: string;
  signal?: AbortSignal;
};

function pickProvider(info: ModelInfo): ProviderId {
  switch (info.provider) {
    case "openai":
      return process.env.OPENAI_API_KEY ? "openai" : "llm7";
    case "groq":
      return process.env.GROQ_API_KEY ? "groq" : "llm7";
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY ? "anthropic" : "llm7";
    case "pollinations":
      return "pollinations";
    default:
      return "llm7";
  }
}

function parseDataUrl(dataUrl: string): { mime: string; data: string } | null {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  return { mime: m[1], data: m[2] };
}

function buildUserContent(
  text: string,
  images: string[],
  vision: boolean,
): string | Array<Record<string, unknown>> {
  if (!vision || images.length === 0) return text;
  const parts: Array<Record<string, unknown>> = [];
  if (text.trim()) parts.push({ type: "text", text });
  for (const img of images) {
    parts.push({ type: "image_url", image_url: { url: img } });
  }
  return parts;
}

function buildAnthropicUserContent(
  text: string,
  images: string[],
): string | Array<Record<string, unknown>> {
  const blocks: Array<Record<string, unknown>> = [];
  if (text.trim()) blocks.push({ type: "text", text });
  for (const img of images) {
    const parsed = parseDataUrl(img);
    if (!parsed) continue;
    blocks.push({
      type: "image",
      source: { type: "base64", media_type: parsed.mime, data: parsed.data },
    });
  }
  if (blocks.length === 1 && blocks[0].type === "text") return text;
  return blocks;
}

function buildSystemPrompt(
  customPrompt: string | undefined,
  searchContext: string,
  images: string[],
  isFreeTier: boolean,
  modelLabel: string,
  modelId: string,
): string {
  let prompt = (customPrompt && customPrompt.trim()) || DEFAULT_SYSTEM_PROMPT;

  prompt +=
    `\n\nТвоя модель: «${modelLabel}» (идентификатор: ${modelId}). ` +
    `Если пользователь спросит, какая ты модель, какая у тебя версия или какой ИИ тебя обслуживает, — честно и прямо назови именно эту модель: «${modelLabel}». Не приписывай себе другую модель.`;

  if (searchContext) {
    prompt +=
      `\n\n--- Результаты веб-поиска ---\n` +
      `Ниже представлены актуальные данные веб-поиска по вопросу пользователя. ` +
      `Используй их для точного ответа, сверяй факты и обязательно цитируй источники с помощью [1], [2]:\n\n${searchContext}`;
  }

  if (images.length > 0 && isFreeTier) {
    prompt +=
      `\n\nПользователь прикрепил изображение(я), но текущая бесплатная текстовая модель не имеет модуля компьютерного зрения (vision). ` +
      `Кратко и вежливо поясни, что для глубокого анализа картинок требуется мультимодальная модель с API-ключом (например GPT-4o или Claude).`;
  }

  return prompt;
}

function cleanHistory(
  history: ChatRequest["history"],
): ChatRequest["history"] {
  const filtered = history.filter(
    (h) => typeof h.content === "string" && h.content.trim().length > 0,
  );
  if (filtered.length === 0) return [];
  const out: ChatRequest["history"] = [];
  for (const h of filtered) {
    const role = h.role === "assistant" ? "assistant" : "user";
    const cur = h.content.trim().slice(0, 8000);
    const prev = out[out.length - 1];
    if (prev && prev.role === role) {
      prev.content = (prev.content + "\n\n" + cur).slice(-8000);
    } else {
      out.push({ role, content: cur });
    }
  }
  if (out.length && out[0].role === "assistant") out.shift();
  return out.slice(-30);
}

function toAnthropicMessages(
  history: ChatRequest["history"],
  userContent: string | Array<Record<string, unknown>>,
): UpstreamMessage[] {
  const cleaned = cleanHistory(history);
  const messages: UpstreamMessage[] = [];
  for (const h of cleaned) {
    const role = h.role === "assistant" ? "assistant" : "user";
    const prev = messages[messages.length - 1];
    if (prev && prev.role === role) {
      prev.content = String(prev.content) + "\n\n" + h.content;
    } else {
      messages.push({ role, content: h.content });
    }
  }
  const last = messages[messages.length - 1];
  const userTextStr = typeof userContent === "string" ? userContent : "";
  const isArray = Array.isArray(userContent);

  if (last && last.role === "user") {
    if (isArray) {
      if (typeof last.content === "string" && last.content.trim()) {
        messages[messages.length - 1] = {
          role: "user",
          content: [{ type: "text", text: last.content }, ...(userContent as Array<Record<string, unknown>>)],
        };
      } else {
        messages[messages.length - 1] = { role: "user", content: userContent };
      }
    } else {
      last.content = String(last.content) + "\n\n" + userTextStr;
    }
  } else {
    messages.push({ role: "user", content: userContent });
  }
  return messages;
}

export async function* streamChat(req: ChatRequest): AsyncGenerator<StreamEvent> {
  const info = resolveModel(req.model);
  const provider = pickProvider(info);

  let searchContext = "";
  if (req.webSearch && req.userText.trim()) {
    try {
      const results = await runWebSearch(req.userText);
      searchContext = formatSearchContext(results);
    } catch {
      searchContext = "";
    }
  }

  const isFree = provider === "llm7" || provider === "pollinations";
  const system = buildSystemPrompt(
    req.systemPrompt,
    searchContext,
    req.images,
    isFree,
    info.label,
    info.id,
  );

  if (provider === "anthropic") {
    const vision = info.vision;
    const userContent = vision
      ? buildAnthropicUserContent(req.userText, req.images)
      : req.userText;
    const messages = toAnthropicMessages(req.history, userContent);
    yield* anthropicStream({
      model: info.id,
      system,
      messages,
      signal: req.signal,
    });
    return;
  }

  const vision = info.vision && !isFree;
  const cleaned = cleanHistory(req.history);
  const messages: UpstreamMessage[] = [
    { role: "system", content: system },
    ...cleaned.map((h) => ({ role: h.role, content: h.content })),
    {
      role: "user",
      content: buildUserContent(req.userText, req.images, vision),
    },
  ];

  if (provider === "openai") {
    yield* openaiStream({ model: info.id, messages, signal: req.signal });
  } else if (provider === "groq") {
    yield* groqStream({ model: info.id, messages, signal: req.signal });
  } else {
    yield* freeTierStream({
      model: info.id,
      messages,
      signal: req.signal,
    });
  }
}
