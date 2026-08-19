export type Role = "system" | "user" | "assistant";

export type StreamEvent =
  | { type: "meta"; conversationId?: string; model?: string }
  | { type: "reasoning"; delta: string }
  | { type: "text"; delta: string }
  | { type: "done" }
  | { type: "error"; message: string };

// ---- Client-side UI types ----
export type UIMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images: string[];
  reasoning?: string;
  model?: string;
  streaming?: boolean;
  error?: string;
  time?: string;
};

export type ConversationSummary = {
  id: string;
  title: string;
  model: string;
  systemPrompt?: string | null;
  createdAt: string;
  updatedAt: string;
};
