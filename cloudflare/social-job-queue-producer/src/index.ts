export interface Env {
  JOB_PARSE_QUEUE: Queue;
  WORKER_AUTH_TOKEN?: string;
}

type QueueExtractionJob = {
  job_id: string;
  post_id: string;
  platform: string;
  title: string;
  description: string;
  location: string;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getBearerToken(req: Request) {
  const header = req.headers.get("Authorization") ?? "";
  const [scheme, token] = header.split(" ");
  if (scheme?.toLowerCase() !== "bearer" || !token) return "";
  return token.trim();
}

function isValidJob(job: unknown): job is QueueExtractionJob {
  if (!job || typeof job !== "object") return false;
  const item = job as Record<string, unknown>;
  return ["job_id", "post_id", "platform", "title", "description", "location"].every(
    (key) => typeof item[key] === "string",
  );
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 200, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const expected = (env.WORKER_AUTH_TOKEN ?? "").trim();
    if (expected) {
      const actual = getBearerToken(req);
      if (!actual || actual !== expected) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
    }

    let payload: unknown;
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const jobsInput = Array.isArray(payload)
      ? payload
      : (payload as { jobs?: unknown[] })?.jobs;

    if (!Array.isArray(jobsInput) || jobsInput.length === 0) {
      return jsonResponse({ error: "jobs array is required" }, 400);
    }

    const jobs = jobsInput.filter(isValidJob);
    if (jobs.length !== jobsInput.length) {
      return jsonResponse({ error: "One or more jobs are missing required string fields" }, 400);
    }

    const now = new Date().toISOString();
    let accepted = 0;

    // Queue sendBatch currently supports up to 100 messages per request.
    for (const chunk of chunkArray(jobs, 100)) {
      await env.JOB_PARSE_QUEUE.sendBatch(
        chunk.map((job) => ({
          body: {
            message_id: crypto.randomUUID(),
            enqueued_at: now,
            ...job,
          },
        })),
      );
      accepted += chunk.length;
    }

    return jsonResponse({ success: true, accepted });
  },
};
