import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
Deno.serve(async (req: Request) => {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  if ((Deno.env.get("TMP_POST_TOKEN") ?? "").trim() !== body?.token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const since = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const { data: runs } = await supabase
    .from("credit_transactions").select("account_id, amount, created_at")
    .eq("type", "usage").like("description", "%ai_match_run%").gte("created_at", since)
    .order("created_at", { ascending: false });
  const { data: posts } = await supabase
    .from("social_hotlist").select("created_by_account_id, created_at, role_title, raw_post_content")
    .eq("post_source", "user_post").gte("created_at", since)
    .order("created_at", { ascending: false });
  return new Response(JSON.stringify({
    window_hours: 3,
    runs: (runs ?? []).map((r) => ({ at: r.created_at, account: String(r.account_id).slice(0, 8), amount: r.amount })),
    posts: (posts ?? []).map((p) => ({
      at: p.created_at, account: String(p.created_by_account_id).slice(0, 8), title: p.role_title,
      content_len: String(p.raw_post_content ?? "").length,
      trailing_ws: /\s$/.test(String(p.raw_post_content ?? "")),
    })),
  }, null, 2), { headers: { "Content-Type": "application/json" } });
});
