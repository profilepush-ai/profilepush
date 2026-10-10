import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// A user's own avatar for their match pictures (see the user_avatars
// migration). Opt-in: make it from their Google photo or an uploaded one, see
// it, then "use" it (their consent). Remove deletes it and every picture made
// with it. Drawn on Cloudflare (FLUX.2) through our pp-image-worker.
//
//   POST { action: "get" }                       -> { avatar, google_photo, avatar_on }
//   POST { action: "make", source: "google" }    -> { avatar }   (a preview, not used yet)
//   POST { action: "make", source: "upload", image: "<base64>" }
//   POST { action: "use" }                       -> { avatar, queued }
//   POST { action: "remove" }                    -> { removed: true }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const respond = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const AVATAR_PROMPT = "Turn the person in the reference photo into a stylized 3D character like a still from a modern animated film. Keep what makes them recognizable: face shape, skin tone, hair and any glasses, beard or head covering. Friendly smile, shown from the waist up, facing the viewer, wearing a navy top. Soft matte clay-like shading, gentle diffused light, a plain pale blue #C8D7FA background. Nothing written anywhere.";

// Their Google profile photo, at a size worth drawing from.
function googlePhoto(user: { user_metadata?: Record<string, unknown>; identities?: Array<{ provider?: string; identity_data?: Record<string, unknown> }> }): string | null {
  const google = user.identities?.find((i) => i.provider === "google")?.identity_data;
  const url = (google?.avatar_url ?? google?.picture ?? user.user_metadata?.avatar_url ?? user.user_metadata?.picture) as string | undefined;
  if (!url || !/googleusercontent\.com/.test(url)) return null;
  return url.replace(/=s\d+(-c)?$/, "=s512-c");
}

const pathOf = (url: string | null | undefined) => url?.split("/job-visuals/")[1]?.split("?")[0];

async function draw(reference: string): Promise<{ bytes: Uint8Array; type: string }> {
  const res = await fetch(`${(Deno.env.get("IMAGE_WORKER_URL") ?? "").replace(/\/$/, "")}/draw`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("IMAGE_WORKER_SECRET") ?? ""}`, "Content-Type": "application/json", "User-Agent": "ProfilePush-my-avatar/1.0" },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ prompt: AVATAR_PROMPT, width: 576, height: 704, reference }),
  });
  const type = res.headers.get("Content-Type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`Could not draw the avatar (${res.status}).`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type };
}

async function store(admin: SupabaseClient, folder: string, bytes: Uint8Array, type: string): Promise<{ path: string; url: string }> {
  // Unguessable paths: these show a real person's likeness.
  const path = `${folder}/${crypto.randomUUID()}.${type.includes("webp") ? "webp" : type.includes("png") ? "png" : "jpg"}`;
  const { error } = await admin.storage.from("job-visuals").upload(path, bytes, { contentType: type });
  if (error) throw new Error(error.message);
  return { path, url: admin.storage.from("job-visuals").getPublicUrl(path).data.publicUrl };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const url = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
  const { data: { user } } = await asUser.auth.getUser();
  if (!user) return respond({ error: "Unauthorized" }, 401);
  const body = await req.json().catch(() => ({})) as { action?: string; source?: string; image?: string };

  const current = async () => (await admin.from("user_avatars").select("status, source, url, consented_at").eq("user_id", user.id).maybeSingle()).data;
  const avatarOn = async () => {
    const { data: account } = await admin.rpc("publisher_account_for_user", { p_user_id: user.id });
    if (!account) return false;
    const { data } = await admin.rpc("pp_avatar_on", { p_account: account });
    return Boolean(data);
  };

  try {
    if (body.action === "get" || !body.action) {
      return respond({ avatar: await current(), google_photo: googlePhoto(user), avatar_on: await avatarOn() });
    }

    if (body.action === "make") {
      let reference: string | null = null;
      let upload: string | undefined;
      if (body.source === "upload") {
        const raw = String(body.image ?? "").replace(/^data:[^,]+,/, "");
        if (!raw || raw.length > 7_000_000) return respond({ error: "Send a photo under 5 MB." }, 400);
        const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
        const saved = await store(admin, "avatars/src", bytes, "image/jpeg");
        reference = saved.url; upload = saved.path;
      } else {
        reference = googlePhoto(user);
        if (!reference) return respond({ error: "No Google photo on this account. Upload one instead." }, 400);
      }
      const before = await current();
      await admin.from("user_avatars").upsert({ user_id: user.id, status: "making", source: body.source === "upload" ? "upload" : "google", error: null, updated_at: new Date().toISOString() });
      try {
        const { bytes, type } = await draw(reference);
        const saved = await store(admin, "avatars", bytes, type);
        // A new avatar is a preview until they choose to use it.
        await admin.from("user_avatars").update({ status: "ready", url: saved.url, consented_at: null, updated_at: new Date().toISOString() }).eq("user_id", user.id);
        const stale = pathOf(before?.url);
        if (stale) await admin.storage.from("job-visuals").remove([stale]);
      } catch (error) {
        await admin.from("user_avatars").update({ status: "failed", error: (error as Error).message.slice(0, 300), updated_at: new Date().toISOString() }).eq("user_id", user.id);
        throw error;
      } finally {
        // The uploaded photo itself isn't kept.
        if (upload) await admin.storage.from("job-visuals").remove([upload]);
      }
      return respond({ avatar: await current() });
    }

    if (body.action === "use") {
      const avatar = await current();
      if (!avatar?.url || !["ready", "active"].includes(avatar.status as string)) return respond({ error: "Make your avatar first." }, 400);
      await admin.from("user_avatars").update({ status: "active", consented_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("user_id", user.id);
      // Their pictures from before (an earlier avatar) are redrawn.
      await admin.from("match_visuals_me").update({ status: "queued", attempts: 0 }).eq("user_id", user.id);
      const { data: queued } = await admin.rpc("queue_my_today", { p_user: user.id });
      return respond({ avatar: await current(), queued: queued ?? 0 });
    }

    if (body.action === "remove") {
      const avatar = await current();
      const { data: pictures } = await admin.from("match_visuals_me").select("url").eq("user_id", user.id);
      const paths = [pathOf(avatar?.url), ...(pictures ?? []).map((p) => pathOf(p.url as string))].filter(Boolean) as string[];
      for (let i = 0; i < paths.length; i += 100) await admin.storage.from("job-visuals").remove(paths.slice(i, i + 100));
      await admin.from("match_visuals_me").delete().eq("user_id", user.id);
      await admin.from("user_avatars").delete().eq("user_id", user.id);
      return respond({ removed: true });
    }

    return respond({ error: "Unknown action." }, 400);
  } catch (error) {
    console.error("my-avatar", error);
    return respond({ error: error instanceof Error ? error.message : "Could not make your avatar." }, 500);
  }
});
