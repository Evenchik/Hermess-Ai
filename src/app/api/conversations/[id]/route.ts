import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseImages(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, id))
    .limit(1);

  if (!conversation) {
    return Response.json({ error: "Не найдено" }, { status: 404 });
  }

  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  return Response.json({
    conversation: {
      id: conversation.id,
      title: conversation.title,
      model: conversation.model,
      systemPrompt: conversation.systemPrompt,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    },
    messages: rows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      images: parseImages(m.images),
      reasoning: m.reasoning ?? undefined,
      model: m.model ?? undefined,
      createdAt: m.createdAt.toISOString(),
    })),
  });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as {
    title?: string;
    model?: string;
    systemPrompt?: string | null;
  };

  const updateData: Partial<typeof conversations.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (typeof body.title === "string") {
    const t = body.title.trim().slice(0, 100);
    if (t) updateData.title = t;
  }

  if (typeof body.model === "string" && body.model) {
    updateData.model = body.model;
  }

  if (body.systemPrompt !== undefined) {
    updateData.systemPrompt =
      typeof body.systemPrompt === "string" && body.systemPrompt.trim()
        ? body.systemPrompt.trim()
        : null;
  }

  await db
    .update(conversations)
    .set(updateData)
    .where(eq(conversations.id, id));

  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  await db.delete(conversations).where(eq(conversations.id, id));
  return Response.json({ ok: true });
}
