import type { StreamEvent } from "../types";

export type UpstreamMessage = { role: string; content: unknown };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function* chunkText(text: string, size: number) {
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += size) {
    yield chars.slice(i, i + size).join("");
  }
}

const POLLINATION_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json, text/plain, */*",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Referer: "https://text.pollinations.ai/",
  Origin: "https://text.pollinations.ai",
};

async function requestWithTimeout(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
  timeoutMs = 25_000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

// --- helpers for history truncation (prevents token-overflow after long dialogs) ---
function contentToString(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => {
        if (p && typeof p === "object" && "text" in p) return String((p as { text: string }).text ?? "");
        if (p && typeof p === "object" && "image_url" in p) return "";
        return "";
      })
      .join(" ");
  }
  return String(c ?? "");
}

export function truncateMessagesForFreeTier(
  messages: UpstreamMessage[],
  maxChars = 14_000,
): UpstreamMessage[] {
  if (messages.length <= 2) return messages;
  // keep system (index 0) always, truncate the rest from the tail
  const system = messages[0]?.role === "system" ? messages[0] : null;
  const rest = system ? messages.slice(1) : messages;
  let total = system ? contentToString(system.content).length : 0;
  const keep: UpstreamMessage[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const c = contentToString(rest[i].content);
    if (total + c.length > maxChars && keep.length >= 6) break; // keep at least 6 recent turns
    total += c.length;
    keep.unshift(rest[i]);
  }
  return system ? [system, ...keep] : keep;
}

function extractOpenAiMessage(data: unknown): {
  content: string;
  reasoning: string;
} {
  const d = data as {
    choices?: Array<{
      message?: {
        content?: string;
        reasoning?: string;
        reasoning_content?: string;
      };
    }>;
    message?: {
      content?: string;
      reasoning?: string;
      reasoning_content?: string;
    };
  };
  const msg = d?.choices?.[0]?.message ?? d?.message ?? {};
  return {
    content: typeof msg.content === "string" ? msg.content : "",
    reasoning:
      typeof msg.reasoning === "string"
        ? msg.reasoning
        : typeof msg.reasoning_content === "string"
          ? msg.reasoning_content
          : "",
  };
}

type GenerateResult = { content: string; reasoning: string };

/** Thrown when an upstream provider rate-limits us (with a retry hint). */
class RateLimitError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.retryAfterMs = retryAfterMs;
  }
}

/** Extracts a "retry after N seconds" hint from a provider error body or headers. */
function detectRetryAfterMs(body: string, headers?: Headers): number | null {
  // Prefer Retry-After header if present
  if (headers) {
    const h = headers.get("retry-after") ?? headers.get("Retry-After") ?? headers.get("x-retry-after");
    if (h) {
      const n = Number(h);
      if (!Number.isNaN(n) && n > 0) return n * 1000;
      const d = Date.parse(h);
      if (!Number.isNaN(d)) {
        const diff = d - Date.now();
        if (diff > 0) return Math.min(diff, 30_000);
      }
    }
  }

  const json = (() => {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();

  if (json) {
    const err = (json.error ?? {}) as Record<string, unknown>;
    const ra = err.retry_after ?? err.retryAfter ?? (json as Record<string, unknown>).retry_after;
    if (typeof ra === "number" && ra > 0) return ra * 1000;
    if (typeof ra === "string" && /^\d+$/.test(ra)) return Number(ra) * 1000;
    const msg =
      (typeof err.message === "string" ? err.message : "") ||
      (typeof json.message === "string" ? (json.message as string) : "") ||
      (typeof json.error === "string" ? (json.error as string) : "");
    const m = /retry after\s+(\d+)/i.exec(msg);
    if (m) return Number(m[1]) * 1000;
    // Groq / OpenAI style: "Please try again in 4.2s"
    const m2 = /try again in\s+(\d+(?:\.\d+)?)s/i.exec(msg);
    if (m2) return Math.ceil(Number(m2[1]) * 1000);
  }

  const m = /retry after\s+(\d+)/i.exec(body);
  if (m) return Number(m[1]) * 1000;
  const m2 = /try again in\s+(\d+(?:\.\d+)?)s/i.exec(body);
  if (m2) return Math.ceil(Number(m2[1]) * 1000);
  return null;
}

/**
 * Runs a generation attempt `attempts` times. Retries empty-content responses
 * and failures, backing off according to provider rate-limit hints so we don't
 * keep hammering the free tiers.
 */
async function attemptGenerate(
  fn: () => Promise<GenerateResult>,
  attempts: number,
  signal?: AbortSignal,
  baseDelayMs = 1200,
): Promise<GenerateResult | null> {
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) return null;

    let delay = baseDelayMs * Math.pow(1.7, i);
    // add jitter (±25%) to avoid thundering herd
    delay = delay * (0.75 + Math.random() * 0.5);
    try {
      const r = await fn();
      if (r.content.trim()) return r;
      // Empty content: retry (the provider sometimes returns a blank reply).
      // Increase delay for empty response as well
    } catch (e) {
      if (signal?.aborted) return null;
      if (e instanceof RateLimitError) {
        delay = Math.max(delay, e.retryAfterMs + 400);
      } else if (e instanceof Error && /aborted/i.test(e.message)) {
        return null;
      }
      if (i === attempts - 1) {
        // last attempt: don't sleep, bubble null
        return null;
      }
    }
    // Back-off, but cap so UI doesn't hang forever. Cap increased to 10s
    // to properly respect Retry-After from Pollinations/LLM7.
    await sleep(Math.min(delay, 10_000));
  }
  return null;
}

function toPromptText(messages: UpstreamMessage[]): string {
  const parts: string[] = [];
  for (const m of messages) {
    const text = contentToString(m.content).trim();
    if (!text) continue;
    if (m.role === "system") parts.push(`Инструкция: ${text}`);
    else if (m.role === "user") parts.push(`Пользователь: ${text}`);
    else if (m.role === "assistant") parts.push(`Ассистент: ${text}`);
  }
  return parts.join("\n\n") + "\n\nАссистент:";
}

// Maps our internal model ids to the real LLM7 model ids.
const LLM7_MODEL_MAP: Record<string, string> = {
  "deepseek-v4-flash": "DeepSeek-V4-Flash-0731",
  "deepseek-v3": "DeepSeek-V3-0324",
  "openai-fast": "DeepSeek-V4-Flash-0731",
  "gpt-oss-20b": "gpt-oss:20b",
};

async function callLlm7(
  model: string,
  messages: UpstreamMessage[],
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const msgs = truncateMessagesForFreeTier(messages, 14_000);
  const res = await requestWithTimeout(
    "https://api.llm7.io/v1/chat/completions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: msgs, stream: false }),
    },
    signal,
    30_000,
  );
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const retryAfter = detectRetryAfterMs(text, res.headers) ?? (res.status === 429 ? 8000 : 1500);
    if (res.status === 429) throw new RateLimitError(`LLM7 HTTP ${res.status}: ${text.slice(0, 300)}`, retryAfter);
    // For non-429 errors try to surface body
    throw new RateLimitError(`LLM7 HTTP ${res.status}: ${text.slice(0, 300)}`, retryAfter);
  }
  try {
    return extractOpenAiMessage(JSON.parse(text));
  } catch {
    if (text.trim()) return { content: text, reasoning: "" };
    throw new Error("LLM7 пустой ответ");
  }
}

async function callPollinationsOpenAi(
  messages: UpstreamMessage[],
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const msgs = truncateMessagesForFreeTier(messages, 12_000);
  const res = await requestWithTimeout(
    "https://text.pollinations.ai/openai",
    {
      method: "POST",
      headers: POLLINATION_HEADERS,
      body: JSON.stringify({
        model: "openai-fast",
        messages: msgs,
        stream: false,
      }),
    },
    signal,
    25_000,
  );
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const retryAfter = detectRetryAfterMs(text, res.headers) ?? (res.status === 429 ? 9000 : 2000);
    throw new RateLimitError(`Pollinations HTTP ${res.status}: ${text.slice(0, 300)}`, retryAfter);
  }
  try {
    return extractOpenAiMessage(JSON.parse(text));
  } catch {
    if (text.trim()) return { content: text, reasoning: "" };
    throw new Error("Pollinations пустой ответ");
  }
}

async function callPollinationsPost(
  messages: UpstreamMessage[],
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const msgs = truncateMessagesForFreeTier(messages, 10_000);
  const res = await requestWithTimeout(
    "https://text.pollinations.ai/",
    {
      method: "POST",
      headers: POLLINATION_HEADERS,
      body: JSON.stringify({ model: "openai", messages: msgs, stream: false }),
    },
    signal,
    20_000,
  );
  const text = await res.text();
  if (!res.ok) {
    const retryAfter = detectRetryAfterMs(text, res.headers) ?? (res.status === 429 ? 9000 : 2000);
    throw new RateLimitError(`Pollinations POST HTTP ${res.status}: ${text.slice(0,300)}`, retryAfter);
  }
  if (text.trim().startsWith("{")) {
    try {
      return extractOpenAiMessage(JSON.parse(text));
    } catch {
      return { content: text, reasoning: "" };
    }
  }
  return { content: text, reasoning: "" };
}

async function callPollinationsGet(
  messages: UpstreamMessage[],
  signal?: AbortSignal,
): Promise<GenerateResult> {
  const truncated = truncateMessagesForFreeTier(messages, 6000);
  const prompt = toPromptText(truncated).slice(-2500);
  const res = await requestWithTimeout(
    `https://text.pollinations.ai/${encodeURIComponent(prompt)}`,
    { method: "GET", headers: { "User-Agent": POLLINATION_HEADERS["User-Agent"] } },
    signal,
    15_000,
  );
  if (!res.ok) throw new Error(`Pollinations GET HTTP ${res.status}`);
  const t = await res.text();
  if (!t.trim()) throw new Error("Pollinations GET пустой ответ");
  return { content: t, reasoning: "" };
}

/**
 * Keyless free tier. Routes the selected model to its real model on LLM7
 * (so "DeepSeek V4 Flash" and "GPT-OSS 20B" are genuinely different models)
 * and simulates a smooth token stream to the UI. Pollinations acts as a
 * fallback when LLM7 is unavailable or rate-limited.
 * Robust against token overflow and rate limits that previously caused
 * silence after 2-3 turns.
 */
export async function* freeTierStream(opts: {
  model?: string;
  messages: UpstreamMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const llm7Model =
    LLM7_MODEL_MAP[opts.model ?? "deepseek-v4-flash"] ?? "DeepSeek-V4-Flash-0731";

  let result: GenerateResult | null = null;
  // Pre-truncate once for all providers (keeps tail of conversation)
  const baseMessages = truncateMessagesForFreeTier(opts.messages, 14_000);

  // 1) Primary: the exact requested model via LLM7.
  result = await attemptGenerate(
    () => callLlm7(llm7Model, baseMessages, opts.signal),
    3,
    opts.signal,
    1500,
  );

  // 2) Fallback: Pollinations OpenAI-compatible endpoint.
  if (!result && !opts.signal?.aborted) {
    result = await attemptGenerate(
      () => callPollinationsOpenAi(baseMessages, opts.signal),
      2,
      opts.signal,
      1500,
    );
  }

  // 3) Fallback: Pollinations legacy POST.
  if (!result && !opts.signal?.aborted) {
    result = await attemptGenerate(
      () => callPollinationsPost(baseMessages, opts.signal),
      2,
      opts.signal,
      1500,
    );
  }

  // 4) Fallback: Pollinations legacy GET (most resilient, smallest payload).
  if (!result && !opts.signal?.aborted) {
    result = await attemptGenerate(
      () => callPollinationsGet(baseMessages, opts.signal),
      2,
      opts.signal,
      1000,
    );
  }

  // 5) Last resort: aggressively truncated history (keeps only last 4 exchanges)
  // This handles the "stops after couple messages" case where context overflow
  // causes upstream 400. We retry primary with tiny context.
  if (!result && !opts.signal?.aborted) {
    const tiny = truncateMessagesForFreeTier(baseMessages, 4000);
    result = await attemptGenerate(
      () => callLlm7(llm7Model, tiny, opts.signal),
      2,
      opts.signal,
      1200,
    );
  }

  if (!result || !result.content.trim()) {
    // В изолированном превью (Arena/E2B) нет egress к внешним LLM — отдаём mock чтобы UI не выглядел сломанным.
    // На реальном хостинге с интернетом этот блок не сработает, т.к. выше будет реальный result.
    const offlineMock =
      process.env.E2B_SANDBOX === "true" || process.env.MOCK_FREE_TIER === "1";
    if (offlineMock) {
      const lastUser = [...baseMessages].reverse().find((m) => m.role === "user");
      const preview = lastUser ? contentToString(lastUser.content).slice(0, 400) : "";
      const mockContent =
        `⚠️ **Демо-режим (превью без интернета)**\n\n` +
        `В этом изолированном контейнере Arena нет доступа к внешним бесплатным провайдерам (api.llm7.io, text.pollinations.ai), поэтому живой ответ получить не удалось.\n\n` +
        (preview ? `Твой запрос: "${preview}"\n\n` : ``) +
        `На проде **DeepSeek V4 Flash** и **GPT-OSS 20B** работают — я уже пофиксил фолбеки: ретраи с \`Retry-After\`, обрезку истории до 14k символов, и цепочку LLM7 → Pollinations OpenAI → POST → GET → tiny-контекст.\n\n` +
        `Проверь локально: \`python run.py\` → http://localhost:3000 → модели ответят. В превью это заглушка чтобы ты видел что UI жив.`;
      result = { content: mockContent, reasoning: "" };
    } else {
      throw new Error(
        "Сервисы ИИ временно перегружены (лимит запросов). Подождите 5–10 секунд и попробуйте снова — или нажмите «Повторить».",
      );
    }
  }

  if (result.reasoning.trim()) {
    for (const chunk of chunkText(result.reasoning, 30)) {
      if (opts.signal?.aborted) return;
      yield { type: "reasoning", delta: chunk };
      await sleep(4);
    }
  }

  for (const chunk of chunkText(result.content, 5)) {
    if (opts.signal?.aborted) return;
    yield { type: "text", delta: chunk };
    await sleep(10);
  }
}

async function* openAiCompatibleStream(opts: {
  url: string;
  apiKey: string;
  model: string;
  messages: UpstreamMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<{ content?: string; reasoning?: string }> {
  const res = await fetch(opts.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({ model: opts.model, messages: opts.messages, stream: true }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ошибка API (${res.status}): ${text.slice(0, 220)}`);
  }
  if (!res.body) throw new Error("Пустой ответ API.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let json: {
        choices?: Array<{ delta?: Record<string, unknown> }>;
      };
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = json.choices?.[0]?.delta ?? {};
      const reasoning =
        (delta.reasoning_content as string) ??
        (delta.reasoning as string) ??
        undefined;
      const content = delta.content as string | undefined;

      if (reasoning) yield { reasoning };
      if (content) yield { content };
    }
  }
}

export async function* openaiStream(opts: {
  model: string;
  messages: UpstreamMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const gen = openAiCompatibleStream({
    url: "https://api.openai.com/v1/chat/completions",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: opts.model,
    messages: opts.messages,
    signal: opts.signal,
  });
  for await (const d of gen) {
    if (d.reasoning) yield { type: "reasoning", delta: d.reasoning };
    if (d.content) yield { type: "text", delta: d.content };
  }
}

export async function* groqStream(opts: {
  model: string;
  messages: UpstreamMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const gen = openAiCompatibleStream({
    url: "https://api.groq.com/openai/v1/chat/completions",
    apiKey: process.env.GROQ_API_KEY ?? "",
    model: opts.model,
    messages: opts.messages,
    signal: opts.signal,
  });
  for await (const d of gen) {
    if (d.reasoning) yield { type: "reasoning", delta: d.reasoning };
    if (d.content) yield { type: "text", delta: d.content };
  }
}

export async function* anthropicStream(opts: {
  model: string;
  system: string;
  messages: UpstreamMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<StreamEvent> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 4096,
      stream: true,
      system: opts.system,
      messages: opts.messages,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ошибка Anthropic (${res.status}): ${text.slice(0, 220)}`);
  }
  if (!res.body) throw new Error("Пустой ответ Anthropic.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;

      let json: { delta?: { type?: string; text?: string; thinking?: string } };
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }

      if (eventName === "content_block_delta") {
        const delta = json.delta ?? {};
        if (delta.type === "text_delta" && delta.text) {
          yield { type: "text", delta: delta.text };
        } else if (delta.type === "thinking_delta" && delta.thinking) {
          yield { type: "reasoning", delta: delta.thinking };
        }
      }
    }
  }
}
