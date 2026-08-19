import { getAvailableModels } from "@/lib/ai/models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(getAvailableModels());
}
