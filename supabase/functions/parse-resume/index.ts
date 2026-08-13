import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { ZipReader, BlobReader, TextWriter } from "npm:@zip.js/zip.js@2";
import {
  computeCost, geminiUrl, fetchWithRetry,
  isCircuitOpen, recordCircuitSuccess, recordCircuitFailure,
  enqueueJob,
} from "../_shared/llm-router.ts";
import { getPromptOverride } from "../_shared/prompts.ts";

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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-From-Queue",
};

// Models tried in order; first non-open-circuit wins
const GEMINI_MODELS = ["gemini-3.1-pro-preview", "gemini-2.0-flash", "gemini-1.5-flash"];

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    candidate_name:   { type: "STRING" },
    target_role:      { type: "STRING" },
    location:         { type: "STRING" },
    city:             { type: "STRING" },
    state:            { type: "STRING" },
    zip_code:         { type: "STRING" },
    country:          { type: "STRING" },
    phone:            { type: "STRING" },
    email:            { type: "STRING" },
    linkedin_url:     { type: "STRING" },
    github_url:       { type: "STRING" },
    portfolio_url:    { type: "STRING" },
    years_experience: { type: "INTEGER" },
    core_skills:      { type: "ARRAY", items: { type: "STRING" } },
    education: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          institution: { type: "STRING" }, degree: { type: "STRING" },
          field:       { type: "STRING" }, start_year: { type: "STRING" },
          end_year:    { type: "STRING" }, gpa: { type: "STRING" },
        },
      },
    },
    experience: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          company:     { type: "STRING" }, title: { type: "STRING" },
          location:    { type: "STRING" }, start_date: { type: "STRING" },
          end_date:    { type: "STRING" }, current: { type: "BOOLEAN" },
          description: { type: "STRING" },
        },
      },
    },
  },
  required: [
    "candidate_name", "target_role", "location", "city", "state",
    "zip_code", "country", "phone", "email", "linkedin_url",
    "github_url", "portfolio_url", "years_experience", "core_skills",
    "education", "experience",
  ],
};

const SYSTEM_INSTRUCTION =
  "You are an expert ATS data extraction engine. Your objective is to parse raw, " +
  "unstructured resume content and extract the candidate's information into a strict JSON format. " +
  "Output ONLY valid JSON matching the exact schema requested. " +
  "If a specific piece of information cannot be found, return an empty string for string fields, " +
  "0 for integer fields, false for boolean fields, and an empty array for array fields. " +
  "Do not guess, hallucinate, or infer data that is not explicitly written, except for 'target_role' " +
  "which should be inferred from the most recent job title or career summary objective. " +
  "For core_skills, extract all distinct technical skills, tools, languages, frameworks, and " +
  "certifications mentioned anywhere in the resume.";

const DEFAULT_USER_INSTRUCTION =
  "Extract the candidate profile from the attached resume according to your system instructions and strict JSON schema.";

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

  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) return jsonError("GEMINI_API_KEY secret is not configured", 500);

  const fromQueue = req.headers.get("X-From-Queue") === "true";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const promptOverride = await getPromptOverride(supabase, "parse-resume");
  const systemInstruction = promptOverride?.systemPrompt?.trim() || SYSTEM_INSTRUCTION;
  const userInstruction = promptOverride?.userPrompt?.trim() || DEFAULT_USER_INSTRUCTION;

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
  let base64: string;
  let filename: string;
  let fileIsText = false;
  let plainText = "";
  const contentType = req.headers.get("content-type") ?? "";

  const SUPPORTED_EXTENSIONS = [".pdf", ".doc", ".docx", ".rtf", ".txt"];

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    base64    = body.base64_pdf ?? "";
    filename  = body.filename   ?? "resume.pdf";
    plainText = body.plain_text ?? "";
    fileIsText = !!plainText || !filename.toLowerCase().endsWith(".pdf");
    if (!base64 && !plainText) return jsonError("Missing base64_pdf or plain_text in JSON body");
  } else {
    let formData: FormData;
    try { formData = await req.formData(); }
    catch { return jsonError("Request must be multipart/form-data or application/json"); }

    const file = formData.get("resume") as File | null;
    if (!file) return jsonError("Missing 'resume' field in form data");

    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return jsonError("Unsupported file type. Please upload PDF, Word (.doc/.docx), RTF, or TXT files.");
    }

    const arrayBuffer = await file.arrayBuffer();

    if (ext === ".pdf") {
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
      base64   = btoa(binary);
      filename = file.name;
    } else if (ext === ".docx") {
      // Extract text from .docx (zip of XML)
      try {
        plainText = await extractTextFromDocx(arrayBuffer);
      } catch {
        return jsonError("Failed to extract text from .docx file. The file may be corrupted.");
      }
      if (!plainText) return jsonError("Could not extract any text from the .docx file.");
      base64 = "";
      filename = file.name;
      fileIsText = true;
    } else if (ext === ".txt") {
      plainText = new TextDecoder().decode(arrayBuffer);
      base64 = "";
      filename = file.name;
      fileIsText = true;
    } else {
      // .doc, .rtf — send as inline binary (Gemini supports these via PDF-like handling)
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
      base64   = btoa(binary);
      filename = file.name;
      fileIsText = true;
    }
  }

  // Build Gemini payload based on file type
  let geminiPayload: Record<string, unknown>;

  if (!fileIsText || (base64 && filename.toLowerCase().endsWith(".pdf"))) {
    // PDF: send as inline binary
    geminiPayload = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{
        parts: [
          { text: userInstruction },
          { inline_data: { mime_type: "application/pdf", data: base64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    };
  } else if (plainText) {
    // Plain text content (from .txt or pasted text)
    geminiPayload = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{
        parts: [
          { text: `${userInstruction}\n\n--- RESUME TEXT ---\n${plainText}\n--- END ---` },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    };
  } else {
    // .docx/.doc/.rtf: send as inline binary with appropriate mime type
    const mimeMap: Record<string, string> = {
      ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ".doc": "application/msword",
      ".rtf": "application/rtf",
    };
    const ext = "." + filename.split(".").pop()?.toLowerCase();
    const mimeType = mimeMap[ext] || "application/octet-stream";

    geminiPayload = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: [{
        parts: [
          { text: userInstruction },
          { inline_data: { mime_type: mimeType, data: base64 } },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.1,
      },
    };
  }

  // ── Try each Gemini model in order ──────────────────────────────────────────
  let geminiData: Record<string, unknown> | null = null;
  let usedModel = "";
  let lastError = "All LLM providers unavailable";

  for (const model of GEMINI_MODELS) {
    if (await isCircuitOpen(supabase, "gemini", model)) continue;

    try {
      const res = await fetchWithRetry(
        geminiUrl(model, GEMINI_API_KEY),
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiPayload) },
      );

      if (!res.ok) {
        const errText = await res.text();
        await recordCircuitFailure(supabase, "gemini", model);
        lastError = `Gemini ${model} error ${res.status}: ${errText.slice(0, 200)}`;
        continue;
      }

      await recordCircuitSuccess(supabase, "gemini", model);
      geminiData = await res.json() as Record<string, unknown>;
      usedModel  = model;
      break;
    } catch (err) {
      await recordCircuitFailure(supabase, "gemini", model);
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  // ── All models failed ────────────────────────────────────────────────────────
  if (!geminiData) {
    if (fromQueue) {
      // Queue processor must not re-enqueue; surface the error directly
      return jsonError(`Parse failed: ${lastError}`, 503);
    }
    try {
      const jobId = await enqueueJob(
        supabase,
        "parse-resume",
        { base64_pdf: base64, filename, plain_text: plainText || undefined },
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

  const rawText = (geminiData?.candidates as Record<string, unknown>[])?.[0]
    ?.content as Record<string, unknown>;
  const text: string = (rawText?.parts as Record<string, unknown>[])?.[0]?.text as string ?? "";

  if (!text) return jsonError("Gemini returned no content", 502);

  // Log usage (fire-and-forget)
  try {
    const usage = (geminiData?.usageMetadata ?? {}) as Record<string, number>;
    const promptTokens     = usage.promptTokenCount     ?? 0;
    const completionTokens = usage.candidatesTokenCount ?? 0;
    const totalTokens      = usage.totalTokenCount      ?? 0;
    const costUsd          = computeCost(usedModel, promptTokens, completionTokens);

    await supabase.from("api_usage_log").insert({
      user_id:           userId,
      account_id:        accountId,
      function_name:     "parse-resume",
      provider:          "gemini",
      model:             usedModel,
      prompt_tokens:     promptTokens,
      completion_tokens: completionTokens,
      total_tokens:      totalTokens,
      cost_usd:          costUsd,
    });
  } catch { /* logging must never break the main response */ }

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(text); }
  catch { return jsonError("Gemini response was not valid JSON", 502); }

  if (Array.isArray(parsed.core_skills)) {
    parsed.core_skills = (parsed.core_skills as string[]).join(", ");
  }

  return new Response(JSON.stringify(parsed), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});
