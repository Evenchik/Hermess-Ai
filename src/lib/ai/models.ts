export type ProviderId = "llm7" | "pollinations" | "openai" | "groq" | "anthropic";

export type ModelInfo = {
  id: string;
  label: string;
  provider: ProviderId;
  vision: boolean;
  reasoning: boolean;
  requiresKey: boolean;
  description: string;
};

export const MODELS: ModelInfo[] = [
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    provider: "llm7",
    vision: false,
    reasoning: false,
    requiresKey: false,
    description: "Быстрая и точная бесплатная модель DeepSeek (0731)",
  },
  {
    id: "deepseek-v3",
    label: "DeepSeek V3",
    provider: "llm7",
    vision: false,
    reasoning: false,
    requiresKey: false,
    description: "Мощная бесплатная модель DeepSeek V3 (0324)",
  },
  {
    id: "deepseek-r1",
    label: "DeepSeek R1",
    provider: "llm7",
    vision: false,
    reasoning: true,
    requiresKey: false,
    description: "Флагман reasoning DeepSeek R1 (0528) — думает пошагово",
  },
  {
    id: "gpt-oss-20b",
    label: "GPT-OSS 20B",
    provider: "llm7",
    vision: false,
    reasoning: true,
    requiresKey: false,
    description: "Reasoning-модель 20B с пошаговыми рассуждениями",
  },
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    provider: "groq",
    vision: false,
    reasoning: true,
    requiresKey: false,
    description: "Честный 120B — Groq 500 tok/s если GROQ_API_KEY, иначе free llm7",
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    vision: true,
    reasoning: false,
    requiresKey: true,
    description: "Флагманская мультимодальная модель OpenAI",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    vision: true,
    reasoning: false,
    requiresKey: true,
    description: "Быстрая и лёгкая модель OpenAI",
  },
  {
    id: "o3-mini",
    label: "o3-mini",
    provider: "openai",
    vision: false,
    reasoning: true,
    requiresKey: true,
    description: "Продвинутая reasoning-модель OpenAI",
  },
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    provider: "groq",
    vision: false,
    reasoning: false,
    requiresKey: true,
    description: "Сверхбыстрая открытая модель (Groq)",
  },
  {
    id: "llama-3.2-90b-vision-preview",
    label: "Llama 3.2 90B Vision",
    provider: "groq",
    vision: true,
    reasoning: false,
    requiresKey: true,
    description: "Vision-модель для анализа изображений (Groq)",
  },
  {
    id: "claude-3-5-sonnet-latest",
    label: "Claude 3.5 Sonnet",
    provider: "anthropic",
    vision: true,
    reasoning: false,
    requiresKey: true,
    description: "Интеллектуальная модель Anthropic",
  },
];

export function getAvailableModels(): {
  models: ModelInfo[];
  providers: Record<string, boolean>;
} {
  const providers: Record<string, boolean> = {
    llm7: true,
    pollinations: true,
    openai: Boolean(process.env.OPENAI_API_KEY),
    groq: Boolean(process.env.GROQ_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  };

  const models = MODELS.filter(
    (m) => !m.requiresKey || providers[m.provider],
  );

  return { models, providers };
}

export function resolveModel(id: string | undefined | null): ModelInfo {
  if (!id) return MODELS[0];
  if (id === "openai-fast") return MODELS[0]; // legacy alias → DeepSeek V4 Flash
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function modelLabel(id: string | undefined | null): string {
  return resolveModel(id).label;
}
