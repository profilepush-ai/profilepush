import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { drawAvatar, googlePhotoUrl, isFacePhoto, storeImage } from "../_shared/avatar.ts";

// Makes the 3D avatar for everyone whose Google photo is a real photo of
// their face and who doesn't have one (and never turned theirs off), and
// turns it on. Letters, logos and drawings are skipped for good: an avatar
// from those would be a stranger. It shows in their match
// pictures, posts and header while they have credits or a plan, and falls
// back to the standard pictures and their Google photo at 0 credits. The app
// tells them once and lets them keep it or turn it off.
//
// Run every few minutes (cron) and safe to call by anyone: it only ever does
// the work that's waiting, a few people at a time.
//   POST { limit?: number }  -> { made, skipped, left }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};
const respond = (payload: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function makeFor(admin: SupabaseClient, userId: string, photo: string): Promise<boolean> {
  const reference = googlePhotoUrl(photo);
  if (!reference) return false;
  // Claim them first, so two runs never draw the same person.
  const { data: claimed } = await admin.from("user_avatars")
    .upsert({ user_id: userId, status: "making", source: "google", updated_at: new Date().toISOString() }, { onConflict: "user_id", ignoreDuplicates: true })
    .select("user_id");
  if (!claimed?.length) return false;
  try {
    if (!(await isFacePhoto(reference))) {
      await admin.from("user_avatars").update({ status: "off", error: "no photo of a face", updated_at: new Date().toISOString() }).eq("user_id", userId);
      return false;
    }
    const { bytes, type } = await drawAvatar(reference, "ProfilePush-avatar-backfill/1.0");
    const saved = await storeImage(admin, "avatars", bytes, type);
    // On, but not yet confirmed by them (consented_at stays empty until they keep it).
    await admin.from("user_avatars").update({ status: "active", url: saved.url, consented_at: null, error: null, updated_at: new Date().toISOString() }).eq("user_id", userId);
    await admin.rpc("pp_sync_user_photo", { p_user: userId });
    await admin.rpc("queue_my_today_if_active", { p_user: userId });
    return true;
  } catch (error) {
    await admin.from("user_avatars").update({ status: "failed", error: (error as Error).message.slice(0, 300), updated_at: new Date().toISOString() }).eq("user_id", userId);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({})) as { limit?: number };
  const limit = Math.max(1, Math.min(12, Number(body.limit) || 6));
  try {
    const { data: todo, error } = await admin.rpc("avatar_backfill_todo", { p_limit: limit });
    if (error) throw error;
    const people = (todo ?? []) as Array<{ user_id: string; photo: string }>;
    let made = 0, skipped = 0;
    // Three at a time.
    for (let i = 0; i < people.length; i += 3) {
      const done = await Promise.all(people.slice(i, i + 3).map((p) => makeFor(admin, p.user_id, p.photo)));
      made += done.filter(Boolean).length;
      skipped += done.filter((d) => !d).length;
    }
    const { data: left } = await admin.rpc("avatar_backfill_left");
    return respond({ made, skipped, left: left ?? null });
  } catch (error) {
    console.error("avatar-backfill", error);
    return respond({ error: error instanceof Error ? error.message : "Could not make avatars." }, 500);
  }
});
