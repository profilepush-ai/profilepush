// ProfilePush's door to Cloudflare Workers AI, for our Supabase functions
// (all calls need Authorization: Bearer <DRAW_SECRET>):
//
//   POST /  or /draw  { prompt, width?, height?, reference? }
//     -> a match's picture: image/webp, or image/jpeg when it can't be converted.
//     reference: an image URL (a user's photo or avatar) the picture keeps
//     the person from.
//   POST /embed  { texts: string[] }  (up to 500)
//     -> { vectors: number[][] }  768 numbers each, for matching
//   POST /chat  { system?, prompt, max_tokens?, json? }
//     -> { text }
//   429 when Workers AI is busy (callers retry or queue).

type Env = {
  AI: { run(model: string, input: unknown): Promise<unknown> };
  IMAGES?: { input(stream: ReadableStream): { output(o: { format: string; quality?: number }): Promise<{ response(): Response }> } };
  DRAW_SECRET: string;
};

const MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
// Every stored vector must come from this one model: change it and every
// post has to be embedded again.
const EMBED_MODEL = "@cf/google/embeddinggemma-300m";
const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const busy = (message: string) => /rate limit|capacity|too many|429|3040/i.test(message);
const fail = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return Response.json({ error: message.slice(0, 300) }, { status: busy(message) ? 429 : 500 });
};

async function embed(env: Env, body: { texts?: unknown }): Promise<Response> {
  const texts = Array.isArray(body.texts) ? body.texts.map((t) => String(t ?? "").slice(0, 6000)) : [];
  if (texts.length === 0 || texts.length > 500) return Response.json({ error: "Send 1 to 500 texts." }, { status: 400 });
  const vectors: number[][] = [];
  try {
    for (let i = 0; i < texts.length; i += 50) {
      const out = (await env.AI.run(EMBED_MODEL, { text: texts.slice(i, i + 50) })) as { data?: number[][] };
      if (!out?.data || out.data.length !== Math.min(50, texts.length - i)) return Response.json({ error: "Incomplete embeddings." }, { status: 502 });
      vectors.push(...out.data);
    }
    return Response.json({ vectors, model: EMBED_MODEL });
  } catch (error) {
    return fail(error);
  }
}

async function chat(env: Env, body: { system?: unknown; prompt?: unknown; max_tokens?: unknown; json?: unknown }): Promise<Response> {
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  if (!prompt) return Response.json({ error: "A prompt is needed." }, { status: 400 });
  const messages = [
    ...(typeof body.system === "string" && body.system ? [{ role: "system", content: body.system }] : []),
    { role: "user", content: prompt },
  ];
  try {
    const out = (await env.AI.run(CHAT_MODEL, {
      messages,
      max_tokens: typeof body.max_tokens === "number" ? Math.min(body.max_tokens, 4096) : 1024,
      ...(body.json === true ? { response_format: { type: "json_object" } } : {}),
    })) as { response?: unknown };
    const text = typeof out?.response === "string" ? out.response : JSON.stringify(out?.response ?? "");
    return Response.json({ text, model: CHAT_MODEL });
  } catch (error) {
    return fail(error);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!env.DRAW_SECRET || req.headers.get("Authorization") !== `Bearer ${env.DRAW_SECRET}`) return new Response("Unauthorized", { status: 401 });
    const path = new URL(req.url).pathname;
    const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (path === "/embed") return embed(env, raw);
    if (path === "/chat") return chat(env, raw);
    const body = raw as { prompt?: unknown; width?: unknown; height?: unknown; reference?: unknown };
    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 2048) : "";
    if (prompt.length < 20) return Response.json({ error: "A prompt is needed." }, { status: 400 });
    // Sizes in multiples of 16, as the model wants.
    const size = (v: unknown, d: number) => (typeof v === "number" && v >= 256 && v <= 1536 ? Math.round(v / 16) * 16 : d);

    // A reference picture (only from our own storage or Google's avatars).
    let reference: Blob | null = null;
    if (typeof body.reference === "string" && body.reference) {
      const host = new URL(body.reference).hostname;
      if (!/(\.supabase\.co|\.googleusercontent\.com)$/.test(host)) return Response.json({ error: "Reference not allowed." }, { status: 400 });
      const ref = await fetch(body.reference);
      if (!ref.ok || !(ref.headers.get("Content-Type") ?? "").startsWith("image/")) return Response.json({ error: "Reference image unavailable." }, { status: 400 });
      reference = await ref.blob();
    }
    // FLUX.2 takes its input as a multipart form.
    const draw = () => {
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("width", String(size(body.width, 704)));
      form.append("height", String(size(body.height, 1056)));
      if (reference) form.append("input_image_0", reference, "reference");
      const packed = new Response(form);
      return env.AI.run(MODEL, { multipart: { body: packed.body, contentType: packed.headers.get("content-type") } }) as Promise<{ image?: string }>;
    };
    try {
      // The safety filter now and then flags a harmless picture (3030); a
      // fresh draw usually passes, so try up to three times.
      let out: { image?: string } | undefined;
      for (let attempt = 0; ; attempt++) {
        try {
          out = await draw();
          break;
        } catch (error) {
          if (attempt >= 2 || !/3030|flagged/i.test(error instanceof Error ? error.message : String(error))) throw error;
        }
      }
      if (!out?.image) return Response.json({ error: "The model returned no picture." }, { status: 502 });
      const jpeg = Uint8Array.from(atob(out.image), (c) => c.charCodeAt(0));
      if (env.IMAGES) {
        try {
          const webp = (await env.IMAGES.input(new Blob([jpeg]).stream()).output({ format: "image/webp", quality: 78 })).response();
          return new Response(webp.body, { headers: { "Content-Type": "image/webp", "X-Model": MODEL } });
        } catch {
          // Send the JPEG as it is.
        }
      }
      return new Response(jpeg, { headers: { "Content-Type": "image/jpeg", "X-Model": MODEL } });
    } catch (error) {
      return fail(error);
    }
  },
};
