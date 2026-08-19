import { db } from "@/db";
import { conversations } from "@/db/schema";
import { desc } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db
    .select()
    .from(conversations)
    .orderBy(desc(conversations.updatedAt))
    .limit(200);

  return Response.json({
    conversations: rows.map((c) => ({
      id: c.id,
      title: c.title,
      model: c.model,
      systemPrompt: c.systemPrompt,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    model?: string;
    systemPrompt?: string;
  };
  const model =
    typeof body.model === "string" && body.model ? body.model : "deepseek-v4-flash";
  const systemPrompt =
    typeof body.systemPrompt === "string" ? body.systemPrompt : null;

  const [created] = await db
    .insert(conversations)
    .values({
      title: "Новый чат",
      model,
      systemPrompt,
    })
    .returning();

  return Response.json({
    conversation: {
      id: created.id,
      title: created.title,
      model: created.model,
      systemPrompt: created.systemPrompt,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    },
  });
}
