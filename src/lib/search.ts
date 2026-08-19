export type SearchResult = {
  title: string;
  snippet: string;
  url: string;
  extract?: string;
};

const WIKI_EN = "https://en.wikipedia.org/w/api.php";
const WIKI_RU = "https://ru.wikipedia.org/w/api.php";
const UA = "Hermess/1.0 (https://hermess.ai)";

async function fetchWithTimeout(
  url: string,
  timeoutMs = 8000,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: { "User-Agent": UA },
      cache: "no-store",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function cleanSnippet(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

async function wikiSearchOne(
  lang: "en" | "ru",
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  const base = lang === "ru" ? WIKI_RU : WIKI_EN;
  const url =
    `${base}?action=query&list=search` +
    `&srsearch=${encodeURIComponent(query)}&format=json&srlimit=${limit}&utf8=1&origin=*`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const data = await res.json();
    const items: Array<{ title?: string; snippet?: string }> =
      data?.query?.search ?? [];

    return items
      .filter((it) => it?.title)
      .map((it) => ({
        title: it.title as string,
        snippet: cleanSnippet(String(it.snippet ?? "")),
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(
          (it.title as string).replace(/ /g, "_"),
        )}`,
      }));
  } catch {
    return [];
  }
}

async function wikiExtract(
  lang: "en" | "ru",
  title: string,
): Promise<string | null> {
  const base = lang === "ru" ? WIKI_RU : WIKI_EN;
  const url =
    `${base}?action=query&prop=extracts&exintro=1&explaintext=1` +
    `&format=json&redirects=1&titles=${encodeURIComponent(title)}&origin=*`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages ?? {};
    for (const key of Object.keys(pages)) {
      if (Number(key) < 0) continue;
      const extract = pages[key]?.extract;
      if (typeof extract === "string" && extract.trim()) {
        return extract.trim().slice(0, 700);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Free, keyless web search across English + Russian Wikipedia. Returns
 * snippets enriched with the article's lead paragraph for better grounding.
 */
export async function webSearch(query: string): Promise<SearchResult[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];

  const [en, ru] = await Promise.all([
    wikiSearchOne("en", q, 4),
    wikiSearchOne("ru", q, 3),
  ]);

  // Merge, prioritising Russian results for Russian-language queries, and
  // deduplicate by title.
  const seen = new Set<string>();
  const merged: SearchResult[] = [];
  for (const r of [...ru, ...en]) {
    const key = r.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(r);
  }

  const top = merged.slice(0, 5);
  if (top.length === 0) return [];

  // Enrich the top results with lead paragraphs.
  const enriched = await Promise.all(
    top.map(async (r) => {
      const lang: "en" | "ru" = r.url.includes("ru.wikipedia") ? "ru" : "en";
      const extract = await wikiExtract(lang, r.title);
      return extract ? { ...r, extract } : r;
    }),
  );

  return enriched;
}

export function formatSearchContext(results: SearchResult[]): string {
  if (!results.length) return "";
  return results
    .map((r, i) => {
      let out = `[${i + 1}] ${r.title}\n${r.snippet}`;
      if (r.extract) {
        out += `\nКраткое содержание статьи: ${r.extract}`;
      }
      out += `\nИсточник: ${r.url}`;
      return out;
    })
    .join("\n\n");
}
