// Draws a match's picture on Cloudflare Workers AI, for the job-visual
// Supabase function (which writes the art direction and stores the result).
//
//   POST { prompt, width?, height? }   Authorization: Bearer <DRAW_SECRET>
//   -> the picture: image/webp, or image/jpeg when it can't be converted
//   429 when Workers AI is busy (job-visual puts the picture back in its queue)

type Env = {
  AI: { run(model: string, input: unknown): Promise<unknown> };
  IMAGES?: { input(stream: ReadableStream): { output(o: { format: string; quality?: number }): Promise<{ response(): Response }> } };
  DRAW_SECRET: string;
};

const MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
    if (!env.DRAW_SECRET || req.headers.get("Authorization") !== `Bearer ${env.DRAW_SECRET}`) return new Response("Unauthorized", { status: 401 });
    const body = (await req.json().catch(() => ({}))) as { prompt?: unknown; width?: unknown; height?: unknown };
    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, 2048) : "";
    if (prompt.length < 20) return Response.json({ error: "A prompt is needed." }, { status: 400 });
    // Sizes in multiples of 16, as the model wants.
    const size = (v: unknown, d: number) => (typeof v === "number" && v >= 256 && v <= 1536 ? Math.round(v / 16) * 16 : d);

    try {
      // FLUX.2 takes its input as a multipart form.
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("width", String(size(body.width, 704)));
      form.append("height", String(size(body.height, 1056)));
      const packed = new Response(form);
      const out = (await env.AI.run(MODEL, { multipart: { body: packed.body, contentType: packed.headers.get("content-type") } })) as { image?: string };
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
      const message = error instanceof Error ? error.message : String(error);
      const busy = /rate limit|capacity|too many|429|3040/i.test(message);
      return Response.json({ error: message.slice(0, 300) }, { status: busy ? 429 : 500 });
    }
  },
};
