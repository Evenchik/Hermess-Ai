import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { streamChat } from "@/lib/ai";
import type { StreamEvent } from "@/lib/types";
import { and, desc, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatBody = {
  conversationId?: string | null;
  model?: string;
  history?: { role: "user" | "assistant"; content: string }[];
  userText?: string;
  images?: string[];
  webSearch?: boolean;
  systemPrompt?: string;
  regenerate?: boolean;
};

function cleanHistory(
  history: { role: "user" | "assistant"; content: string }[],
): { role: "user" | "assistant"; content: string }[] {
  const filtered = history.filter(
    (h) =>
      (h.role === "user" || h.role === "assistant") &&
      typeof h.content === "string" &&
      h.content.trim().length > 0,
  );
  if (filtered.length === 0) return [];
  const out: typeof filtered = [];
  for (const h of filtered) {
    const cur = h.content.trim().slice(0, 8000);
    const prev = out[out.length - 1];
    if (prev && prev.role === h.role) {
      prev.content = (prev.content + "\n\n" + cur).slice(-8000);
    } else {
      out.push({ role: h.role, content: cur });
    }
  }
  if (out.length && out[0].role === "assistant") out.shift();
  return out.slice(-30);
}

// wrapper to swallow DB errors when Postgres is not available (preview without DB)
async function tryDb<T>(fn: () => Promise<T>, fallback?: T): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    console.warn("[chat] DB unavailable, continuing without persistence:", (e as Error)?.message?.slice(0, 200));
    return fallback;
  }
}

export async function POST(req: Request) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return Response.json({ error: "Некорректный JSON" }, { status: 400 });
  }

  const model =
    typeof body?.model === "string" && body.model ? body.model : "deepseek-v4-flash";
  const rawHistory = Array.isArray(body?.history) ? body.history.slice(-60) : [];
  const safeHistory = cleanHistory(
    rawHistory as { role: "user" | "assistant"; content: string }[],
  );
  const text = typeof body?.userText === "string" ? body.userText.slice(0, 8000) : "";
  const safeImages = Array.isArray(body?.images)
    ? body.images.filter((i) => typeof i === "string" && i.startsWith("data:")).slice(0, 8)
    : [];
  const webSearch = Boolean(body?.webSearch);
  const regenerate = Boolean(body?.regenerate);
  const userSystemPrompt =
    typeof body?.systemPrompt === "string" && body.systemPrompt.trim()
      ? body.systemPrompt.trim().slice(0, 4000)
      : undefined;

  if (!text.trim() && safeImages.length === 0) {
    return Response.json({ error: "Пустое сообщение" }, { status: 400 });
  }

  let convId: string | null =
    typeof body?.conversationId === "string" && body.conversationId
      ? body.conversationId
      : null;

  let existingSystemPrompt: string | undefined = undefined;

  if (convId) {
    const existing = await tryDb(() =>
      db
        .select({ id: conversations.id, systemPrompt: conversations.systemPrompt })
        .from(conversations)
        .where(eq(conversations.id, convId!))
        .limit(1),
    );
    if (existing && existing.length > 0) {
      existingSystemPrompt = existing[0].systemPrompt ?? undefined;
    } else if (!existing) {
      // DB down — keep convId as is (client-provided), don't null it
    } else {
      convId = null;
    }
  }

  const effectiveSystemPrompt = userSystemPrompt ?? existingSystemPrompt;

  if (!convId) {
    const title = (text.trim() || "Чат с изображением").slice(0, 60);
    const created = await tryDb(() =>
      db
        .insert(conversations)
        .values({
          title,
          model,
          systemPrompt: effectiveSystemPrompt ?? null,
        })
        .returning({ id: conversations.id }),
    );
    if (created && created[0]?.id) {
      convId = created[0].id;
    } else {
      // DB unavailable — generate ephemeral id for preview
      convId = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36);
    }
  } else if (userSystemPrompt && userSystemPrompt !== existingSystemPrompt) {
    await tryDb(() =>
      db
        .update(conversations)
        .set({ systemPrompt: userSystemPrompt, updatedAt: new Date() })
        .where(eq(conversations.id, convId!)),
    );
  }

  if (regenerate) {
    await tryDb(async () => {
      const latest = await db
        .select({ id: messages.id })
        .from(messages)
        .where(and(eq(messages.conversationId, convId!), eq(messages.role, "assistant")))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      if (latest.length > 0) {
        await db.delete(messages).where(eq(messages.id, latest[0].id));
      }
    });
  } else {
    await tryDb(() =>
      db.insert(messages).values({
        conversationId: convId!,
        role: "user",
        content: text,
        images: JSON.stringify(safeImages),
      }),
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: StreamEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {}
      };

      let assistantText = "";
      let reasoning = "";

      const persistAssistant = async () => {
        if (!assistantText.trim()) return;
        await tryDb(() =>
          db.insert(messages).values({
            conversationId: convId!,
            role: "assistant",
            content: assistantText,
            reasoning: reasoning || null,
            model,
          }),
        );
      };

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {}
      }, 15_000);

      try {
        send({ type: "meta", conversationId: convId!, model });

        const gen = streamChat({
          model,
          history: safeHistory,
          userText: text,
          images: safeImages,
          webSearch,
          systemPrompt: effectiveSystemPrompt,
          signal: req.signal,
        });

        for await (const ev of gen) {
          if (req.signal.aborted) break;
          if (ev.type === "text") assistantText += ev.delta;
          if (ev.type === "reasoning") reasoning += ev.delta;
          send(ev);
        }

        if (!assistantText.trim()) {
          if (reasoning.trim()) {
            assistantText = reasoning;
            reasoning = "";
            send({ type: "text", delta: assistantText });
            send({ type: "done" });
            await persistAssistant();
          } else {
            send({
              type: "error",
              message:
                "Модель вернула пустой ответ. Подождите пару секунд и нажмите «Повторить» — часто помогает смена очереди бесплатного провайдера.",
            });
          }
        } else {
          send({ type: "done" });
          await persistAssistant();
        }
        await tryDb(() =>
          db
            .update(conversations)
            .set({ updatedAt: new Date(), model })
            .where(eq(conversations.id, convId!)),
        );
      } catch (err) {
        if (req.signal.aborted) {
          await persistAssistant();
        } else {
          const message = err instanceof Error ? err.message : "Неизвестная ошибка";
          send({ type: "error", message });
        }
      } finally {
        clearInterval(keepAlive);
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
