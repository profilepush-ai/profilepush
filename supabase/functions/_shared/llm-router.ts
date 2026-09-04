import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ── Pricing (USD per token) ──────────────────────────────────────────────────
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.1-pro-preview": { input: 1.25 / 1e6, output: 5.00 / 1e6 },
  "gemini-2.5-pro-preview": { input: 1.25 / 1e6, output: 5.00 / 1e6 },
  "gemini-2.5-flash":       { input: 0.075 / 1e6, output: 0.30 / 1e6 },
  "gemini-2.0-flash":       { input: 0.075 / 1e6, output: 0.30 / 1e6 },
  "gemini-1.5-flash":       { input: 0.075 / 1e6, output: 0.30 / 1e6 },
  "gpt-4o-mini":            { input: 0.15 / 1e6,  output: 0.60 / 1e6 },
  "llama-3.1-8b-instruct-fp8": { input: 0.152 / 1e6, output: 0.287 / 1e6 },
};

export function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model] ?? PRICING["gemini-2.0-flash"]!;
  return inputTokens * p.input + outputTokens * p.output;
}

export function geminiUrl(model: string, apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

// ── Retry fetch (exponential backoff on 429/503) ─────────────────────────────
const RETRY_BASE_MS = 600;

async function sleep(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3,
): Promise<Response> {
  let lastErr: Error = new Error("No attempts made");
  for (let i = 0; i < maxRetries; i++) {
    if (i > 0) await sleep(RETRY_BASE_MS * Math.pow(2, i - 1));
    try {
      const res = await fetch(url, init);
      if (res.status === 429 || res.status === 503) {
        const body = await res.text();
        lastErr = new Error(`HTTP ${res.status}: ${body}`);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr;
}

// ── Circuit breaker ──────────────────────────────────────────────────────────
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 120_000; // 2 minutes

export async function isCircuitOpen(
  supabase: SupabaseClient,
  provider: string,
  model: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("llm_circuit_breakers")
    .select("state, opened_at")
    .eq("provider", provider)
    .eq("model", model)
    .maybeSingle();

  if (!data || data.state === "closed") return false;

  if (data.state === "open") {
    const elapsed = Date.now() - new Date(data.opened_at).getTime();
    if (elapsed > COOLDOWN_MS) {
      await supabase
        .from("llm_circuit_breakers")
        .update({ state: "half_open", updated_at: new Date().toISOString() })
        .eq("provider", provider)
        .eq("model", model);
      return false; // Allow one probe through
    }
    return true; // Still cooling down
  }

  return false; // half_open = allow probe
}

export async function recordCircuitSuccess(
  supabase: SupabaseClient,
  provider: string,
  model: string,
): Promise<void> {
  await supabase.from("llm_circuit_breakers").upsert(
    {
      provider,
      model,
      state: "closed",
      failure_count: 0,
      last_failure_at: null,
      opened_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider,model" },
  );
}

export async function recordCircuitFailure(
  supabase: SupabaseClient,
  provider: string,
  model: string,
): Promise<void> {
  const { data: cur } = await supabase
    .from("llm_circuit_breakers")
    .select("failure_count")
    .eq("provider", provider)
    .eq("model", model)
    .maybeSingle();

  const newCount = (cur?.failure_count ?? 0) + 1;
  const nowIso   = new Date().toISOString();
  const open     = newCount >= FAILURE_THRESHOLD;

  await supabase.from("llm_circuit_breakers").upsert(
    {
      provider,
      model,
      state:           open ? "open" : "closed",
      failure_count:   newCount,
      last_failure_at: nowIso,
      opened_at:       open ? nowIso : null,
      updated_at:      nowIso,
    },
    { onConflict: "provider,model" },
  );
}

// ── Job queue ────────────────────────────────────────────────────────────────
export async function enqueueJob(
  supabase: SupabaseClient,
  type: "parse-resume" | "score-job-match",
  payload: Record<string, unknown>,
  accountId: string | null,
  userId: string | null,
): Promise<string> {
  const { data, error } = await supabase
    .from("llm_job_queue")
    .insert({ type, payload, account_id: accountId, user_id: userId })
    .select("id")
    .single();
  if (error) throw new Error(`Enqueue failed: ${error.message}`);
  return data.id as string;
}
