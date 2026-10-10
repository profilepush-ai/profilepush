// Embeddings for matching, on Cloudflare Workers AI (EmbeddingGemma, 768
// numbers) through our pp-image-worker. Every vector we compare must come
// from the same model and the same text, so all of them come from here.

const list = (value: unknown) => (Array.isArray(value) ? (value as unknown[]).filter(Boolean).map(String).join(", ") : "");

// A job and a consultant describing the same work should read alike, so both
// use the same fields in the same order.
export function jobText(row: Record<string, unknown>, location = row.location): string {
  const parts: string[] = [];
  if (row.job_title) parts.push(`Job Title: ${row.job_title}`);
  const skills = list(row.extracted_skills);
  if (skills) parts.push(`Required Skills: ${skills}`);
  if (row.extracted_experience_years != null) parts.push(`Required Experience: ${row.extracted_experience_years} years`);
  const visas = list(row.extracted_visa_types);
  if (visas) parts.push(`Visa Types: ${visas}`);
  if (row.extracted_hourly_rate_min || row.extracted_hourly_rate_max) {
    parts.push(`Rate: $${row.extracted_hourly_rate_min ?? "?"}-$${row.extracted_hourly_rate_max ?? "?"}/hr`);
  }
  if (location) parts.push(`Location: ${location}`);
  const description = String(row.job_description || row.post_content || "");
  if (description) parts.push(`Description: ${description.slice(0, 1500)}`);
  return parts.join("\n") || String(row.job_title ?? "Job");
}

export function hotlistText(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.role_title) parts.push(`Job Title: ${row.role_title}`);
  const skills = list(row.core_skills);
  if (skills) parts.push(`Required Skills: ${skills}`);
  if (row.years_experience != null) parts.push(`Required Experience: ${row.years_experience} years`);
  if (row.visa_type) parts.push(`Visa Types: ${row.visa_type}`);
  if (row.hourly_rate_min || row.hourly_rate_max) parts.push(`Rate: $${row.hourly_rate_min ?? "?"}-$${row.hourly_rate_max ?? "?"}/hr`);
  const locations = list(row.locations);
  if (locations) parts.push(`Location: ${locations}`);
  if (row.employment_type) parts.push(`Employment Type: ${row.employment_type}`);
  const content = String(row.raw_post_content ?? "");
  if (content) parts.push(`Description: ${content.slice(0, 1500)}`);
  return parts.join("\n") || String(row.role_title ?? "Consultant");
}

export const EMBEDDING_MODEL = "embeddinggemma-300m";

// Up to 500 texts a call; retried when Workers AI is busy.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 500) {
    const chunk = texts.slice(i, i + 500);
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${(Deno.env.get("IMAGE_WORKER_URL") ?? "").replace(/\/$/, "")}/embed`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("IMAGE_WORKER_SECRET") ?? ""}`,
          "Content-Type": "application/json",
          "User-Agent": "ProfilePush-embeddings/1.0",
        },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({ texts: chunk }),
      });
      if (res.ok) {
        const vectors = ((await res.json()) as { vectors?: number[][] }).vectors ?? [];
        if (vectors.length !== chunk.length) throw new Error("Embedding response was incomplete");
        out.push(...vectors);
        break;
      }
      if ((res.status !== 429 && res.status < 500) || attempt >= 2) {
        throw new Error(`Embedding request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 800 * 2 ** attempt));
    }
  }
  return out;
}

export const toVector = (values: number[]) => `[${values.join(",")}]`;
