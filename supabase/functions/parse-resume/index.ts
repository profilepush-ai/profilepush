import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ZipReader, BlobReader, TextWriter } from "npm:@zip.js/zip.js@2";
import { getDocumentProxy, extractText } from "npm:unpdf@1.8.1";
import {
  computeCost, isCircuitOpen, recordCircuitSuccess, recordCircuitFailure,
  enqueueJob,
} from "../_shared/llm-router.ts";
import { getPromptOverride } from "../_shared/prompts.ts";

// Extracts structured candidate data from an uploaded resume. Text extraction
// (PDF/DOCX/RTF/TXT -> plain text) happens here in Deno; the actual JSON
// extraction runs on Cloudflare Workers AI via the social-job-parser Worker's
// /parse-resume-text route (it already owns the AI binding and the
// JSON-parsing/retry helpers this needs — this function extracts text and
// orchestrates, it doesn't call any LLM directly).

async function extractTextFromDocx(arrayBuffer: ArrayBuffer): Promise<string> {
  const blob = new Blob([arrayBuffer]);
  const zipReader = new ZipReader(new BlobReader(blob));
  const entries = await zipReader.getEntries();
  const docEntry = entries.find((e) => e.filename === "word/document.xml");
  if (!docEntry || !docEntry.getData) {
    await zipReader.close();
    return "";
  }
  const xml = await docEntry.getData(new TextWriter());
  await zipReader.close();
  // Strip XML tags, normalize whitespace
  return xml
    .replace(/<w:p[^>]*\/>/g, "\n")
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<\/w:p>/g, "")
    .replace(/<w:tab\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractTextFromPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(arrayBuffer));
  const { text } = await extractText(pdf, { mergePages: true });
  return (Array.isArray(text) ? text.join("\n") : text).trim();
}

// RTF is mostly readable text wrapped in control words/groups — this is a
// best-effort strip (not a full RTF parser), sufficient for extracting the
// visible text most resume-formatted RTF files contain.
function extractTextFromRtf(raw: string): string {
  return raw
    .replace(/\\par[d]?\b/g, "\n")
    .replace(/\\tab\b/g, "\t")
    .replace(/\{\\[^{}]*\}/g, "")
    .replace(/\\'[0-9a-fA-F]{2}/g, "")
    .replace(/\\[a-zA-Z]+-?\d*\s?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-From-Queue",
};

const CLOUDFLARE_AI_MODEL_LABEL = "llama-3.1-8b-instruct-fp8";

const DEFAULT_USER_INSTRUCTION =
  "Extract the candidate profile from the resume text below according to your system instructions and strict JSON schema.";

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const workerUrl = (Deno.env.get("CLOUDFLARE_WORKER_URL") ?? "").trim();
  const workerToken = (Deno.env.get("CLOUDFLARE_WORKER_TOKEN") ?? "").trim();
  if (!workerUrl) return jsonError("CLOUDFLARE_WORKER_URL secret is not configured", 500);

  const fromQueue = req.headers.get("X-From-Queue") === "true";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const promptOverride = await getPromptOverride(supabase, "parse-resume");
  const systemPrompt = promptOverride?.systemPrompt?.trim() || undefined;
  const userPrompt = promptOverride?.userPrompt?.trim() || DEFAULT_USER_INSTRUCTION;

  // Resolve user/account from auth header
  let userId: string | null = null;
  let accountId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    try {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id ?? null;
      if (userId) {
        const { data: member } = await supabase
          .from("account_members")
          .select("account_id")
          .eq("user_id", userId)
          .limit(1)
          .maybeSingle();
        accountId = member?.account_id ?? null;
      }
    } catch { /* auth resolution failure is non-fatal */ }
  }

  // Credit guard — reject if account has no balance
  if (accountId && !fromQueue) {
    const { data: hasFunds } = await supabase.rpc("check_credit_balance", {
      p_account_id: accountId,
      p_min_balance: 0.001,
    });
    if (hasFunds === false) {
      return jsonError("Insufficient credits. Please top up your account.", 402);
    }
  }

  // Accept both multipart/form-data (UI upload) and application/json (queue processor)
  let plainText = "";
  let filename = "resume";
  const contentType = req.headers.get("content-type") ?? "";

  const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".rtf", ".txt"];

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    filename = body.filename ?? "resume.pdf";
    if (typeof body.plain_text === "string" && body.plain_text.trim()) {
      plainText = body.plain_text;
    } else if (typeof body.base64_pdf === "string" && body.base64_pdf) {
      try {
        const binary = atob(body.base64_pdf);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        plainText = await extractTextFromPdf(bytes.buffer);
      } catch (error) {
        return jsonError(`Failed to extract text from queued PDF: ${(error as Error).message}`, 422);
      }
    }
    if (!plainText) return jsonError("Missing plain_text or base64_pdf in JSON body");
  } else {
    let formData: FormData;
    try { formData = await req.formData(); }
    catch { return jsonError("Request must be multipart/form-data or application/json"); }

    const file = formData.get("resume") as File | null;
    if (!file) return jsonError("Missing 'resume' field in form data");

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (ext === ".doc") {
      return jsonError("Legacy .doc files aren't supported — please upload as PDF, DOCX, RTF, or TXT.");
    }
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return jsonError("Unsupported file type. Please upload PDF, Word (.docx), RTF, or TXT files.");
    }

    const arrayBuffer = await file.arrayBuffer();
    filename = file.name;

    try {
      if (ext === ".pdf") {
        plainText = await extractTextFromPdf(arrayBuffer);
      } else if (ext === ".docx") {
        plainText = await extractTextFromDocx(arrayBuffer);
      } else if (ext === ".rtf") {
        plainText = extractTextFromRtf(new TextDecoder().decode(arrayBuffer));
      } else {
        plainText = new TextDecoder().decode(arrayBuffer);
      }
    } catch (error) {
      return jsonError(`Failed to extract text from the ${ext} file: ${(error as Error).message}`);
    }

    if (!plainText.trim()) return jsonError(`Could not extract any text from the ${ext} file.`);
  }

  // ── Call Cloudflare Workers AI via social-job-parser ────────────────────────
  let parsed: Record<string, unknown> | null = null;
  let lastError = "Resume parsing service unavailable";

  if (!(await isCircuitOpen(supabase, "cloudflare", CLOUDFLARE_AI_MODEL_LABEL))) {
    try {
      const res = await fetch(`${workerUrl.replace(/\/$/, "")}/parse-resume-text`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
        },
        body: JSON.stringify({ resumeText: plainText, systemPrompt, userPrompt }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.ok) {
        parsed = await res.json();
        await recordCircuitSuccess(supabase, "cloudflare", CLOUDFLARE_AI_MODEL_LABEL);
      } else {
        const errText = await res.text();
        await recordCircuitFailure(supabase, "cloudflare", CLOUDFLARE_AI_MODEL_LABEL);
        lastError = `Resume parser error ${res.status}: ${errText.slice(0, 200)}`;
      }
    } catch (err) {
      await recordCircuitFailure(supabase, "cloudflare", CLOUDFLARE_AI_MODEL_LABEL);
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── Parsing unavailable ──────────────────────────────────────────────────────
  if (!parsed) {
    if (fromQueue) {
      // Queue processor must not re-enqueue; surface the error directly
      return jsonError(`Parse failed: ${lastError}`, 503);
    }
    try {
      const jobId = await enqueueJob(
        supabase,
        "parse-resume",
        { plain_text: plainText, filename },
        accountId,
        userId,
      );
      return new Response(JSON.stringify({ queued: true, job_id: jobId }), {
        status: 202,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch (qErr) {
      return jsonError(`Parse failed and queue unavailable: ${lastError}`, 503);
    }
  }

  // Log usage (fire-and-forget) — Workers AI pricing is per-token same as
  // before, just a different provider/model.
  try {
    const promptTokens = Math.ceil(plainText.length / 4);
    const completionTokens = Math.ceil(JSON.stringify(parsed).length / 4);
    const costUsd = computeCost(CLOUDFLARE_AI_MODEL_LABEL, promptTokens, completionTokens);

    await supabase.from("api_usage_log").insert({
      user_id: userId,
      account_id: accountId,
      function_name: "parse-resume",
      provider: "cloudflare",
      model: CLOUDFLARE_AI_MODEL_LABEL,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      cost_usd: costUsd,
    });
  } catch { /* logging must never break the main response */ }

  if (Array.isArray(parsed.core_skills)) {
    parsed.core_skills = (parsed.core_skills as string[]).join(", ");
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});
