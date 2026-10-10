import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// A user's stylized 3D avatar, drawn from a reference photo on Cloudflare
// (FLUX.2) through our pp-image-worker. Used by my-avatar (one user, on
// request) and avatar-backfill (everyone with a Google photo).

export const AVATAR_PROMPT = "Turn the person in the reference photo into a stylized 3D character like a still from a modern animated film. Keep what makes them recognizable: face shape, skin tone, hair and any glasses, beard or head covering. Friendly smile, shown from the waist up, facing the viewer, wearing a navy top. Soft matte clay-like shading, gentle diffused light, a plain pale blue #C8D7FA background. Nothing written anywhere.";

// A Google profile photo at a size worth drawing from, or null.
export function googlePhotoUrl(url: string | null | undefined): string | null {
  if (!url || !/googleusercontent\.com/.test(url)) return null;
  return url.replace(/=s\d+(-c)?$/, "=s512-c");
}

export const pathOf = (url: string | null | undefined) => url?.split("/job-visuals/")[1]?.split("?")[0];

export async function drawAvatar(reference: string, agent = "ProfilePush-avatar/1.0"): Promise<{ bytes: Uint8Array; type: string }> {
  const res = await fetch(`${(Deno.env.get("IMAGE_WORKER_URL") ?? "").replace(/\/$/, "")}/draw`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("IMAGE_WORKER_SECRET") ?? ""}`, "Content-Type": "application/json", "User-Agent": agent },
    signal: AbortSignal.timeout(120_000),
    body: JSON.stringify({ prompt: AVATAR_PROMPT, width: 576, height: 704, reference }),
  });
  const type = res.headers.get("Content-Type") ?? "";
  if (!res.ok || !type.startsWith("image/")) throw new Error(`Could not draw the avatar (${res.status}).`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), type };
}

// Whether a photo is a close-up of one person's face. Most Google profile
// "photos" are a letter on a colour, a logo or a drawing, and some show a
// group or someone far away; an avatar drawn from those would be a stranger.
// A vision model on Cloudflare looks twice and must say close-up both times.
const CLOSEUP_QUESTION = "Describe this photo with exactly one word from this list: closeup (a photo of exactly one person whose face is large and clearly visible), distant (one person, but small or far away), group (more than one person), other.";

async function look(url: string): Promise<string> {
  const res = await fetch(`${(Deno.env.get("IMAGE_WORKER_URL") ?? "").replace(/\/$/, "")}/see`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("IMAGE_WORKER_SECRET") ?? ""}`, "Content-Type": "application/json", "User-Agent": "ProfilePush-avatar/1.0" },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ image: url, max_tokens: 6, question: CLOSEUP_QUESTION }),
  });
  if (!res.ok) throw new Error(`Could not check the photo (${res.status}).`);
  const { text } = await res.json() as { text?: string };
  return (text ?? "").trim().toLowerCase();
}

export async function isFacePhoto(url: string): Promise<boolean> {
  const answers = await Promise.all([look(url), look(url)]);
  return answers.every((a) => /^\W*closeup\b/.test(a));
}

export async function storeImage(admin: SupabaseClient, folder: string, bytes: Uint8Array, type: string): Promise<{ path: string; url: string }> {
  // Unguessable paths: these show a real person's likeness.
  const path = `${folder}/${crypto.randomUUID()}.${type.includes("webp") ? "webp" : type.includes("png") ? "png" : "jpg"}`;
  const { error } = await admin.storage.from("job-visuals").upload(path, bytes, { contentType: type });
  if (error) throw new Error(error.message);
  return { path, url: admin.storage.from("job-visuals").getPublicUrl(path).data.publicUrl };
}
