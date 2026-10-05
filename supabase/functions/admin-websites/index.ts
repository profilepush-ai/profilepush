// Admin > Website Demos. Password-gated like every other admin-* function,
// on the service role.
//
// Actions:
//   list                                   demo requests + every website with stats
//   generate  { request_id } | { url, name?, email?, template? }
//                                          crawl the firm's site, write content with
//                                          Claude, render, save as a demo (background)
//   rerender  { website_id, template }     same content, another template
//   update    { website_id, claim_emails?, claim_domain?, extend_days?, name?, showcase? }
//   request_status { request_id, status }
//   delete    { website_id }               unclaimed demos only
//   analytics { website_id, days? }

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";
import { crawlSite, generateContent, slugForHost } from "../_shared/website-templates/generate.ts";
import { renderSite, TEMPLATE_NAMES, type SiteContent } from "../_shared/website-templates/render.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const pickTemplate = (t: unknown) => (typeof t === "string" && TEMPLATE_NAMES.includes(t) ? t : "nova");

async function uniqueSlug(db: SupabaseClient, base: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${i + 1}`;
    const { data } = await db.from("websites").select("id").eq("slug", slug).maybeSingle();
    if (!data) return slug;
  }
  throw new Error("Could not find a free address for this site.");
}

// The whole generation: runs after the response has gone back.
async function runGeneration(db: SupabaseClient, requestId: string, template: string): Promise<void> {
  const setJob = (fields: Record<string, unknown>) => db.from("website_demo_requests").update(fields).eq("id", requestId);
  try {
    await setJob({ generation_status: "running", generation_error: null, template });
    const { data: req, error } = await db.from("website_demo_requests").select("*").eq("id", requestId).single();
    if (error || !req) throw new Error("Demo request not found.");

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set for edge functions.");

    const crawl = await crawlSite(req.website_url);
    const content = await generateContent(crawl, apiKey);
    const html = renderSite(template, content);
    const slug = await uniqueSlug(db, slugForHost(crawl.host));
    const requesterEmail = String(req.email ?? "").toLowerCase();
    const sameDomain = requesterEmail.split("@")[1] === crawl.host;

    const { data: site, error: insertErr } = await db.from("websites").insert({
      slug,
      name: content.company_name || req.company,
      source_url: crawl.url,
      html,
      template,
      content,
      claim_domain: crawl.host,
      // The person who asked can claim even from a personal address.
      claim_emails: requesterEmail && !sameDomain ? [requesterEmail] : [],
      demo_request_id: req.id,
    }).select("id").single();
    if (insertErr || !site) throw new Error(`Could not save the demo: ${insertErr?.message}`);

    await setJob({ generation_status: "done", generated_at: new Date().toISOString(), website_id: site.id, status: "in_progress" });
  } catch (err) {
    console.error("website generation failed", err);
    await setJob({ generation_status: "failed", generation_error: err instanceof Error ? err.message.slice(0, 500) : String(err) });
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const payload = await req.json();
    if (payload.password !== ADMIN_PASSWORD) return json({ error: "Invalid password" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const action = String(payload.action ?? "list");

    if (action === "list") {
      const [{ data: requests, error: rErr }, { data: sites, error: sErr }] = await Promise.all([
        db.from("website_demo_requests")
          .select("id, created_at, name, email, phone, company, website_url, notes, status, source, generation_status, generation_error, generated_at, website_id, template")
          .order("created_at", { ascending: false })
          .limit(300),
        db.rpc("admin_website_overview"),
      ]);
      if (rErr || sErr) return json({ error: (rErr ?? sErr)!.message }, 500);
      return json({ requests, sites, templates: TEMPLATE_NAMES });
    }

    if (action === "generate") {
      const template = pickTemplate(payload.template);
      let requestId = typeof payload.request_id === "string" ? payload.request_id : null;
      if (!requestId) {
        const url = String(payload.url ?? "").trim();
        if (!url) return json({ error: "Enter the firm's website." }, 400);
        const host = (() => { try { return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname; } catch { return ""; } })();
        if (!host) return json({ error: "That website address doesn't look right." }, 400);
        const { data: created, error } = await db.from("website_demo_requests").insert({
          name: String(payload.name ?? "").trim() || "Admin",
          email: String(payload.email ?? "").trim() || "admin@profilepush.ai",
          company: String(payload.company ?? "").trim() || host.replace(/^www\./, ""),
          website_url: url,
          source: "admin",
        }).select("id").single();
        if (error || !created) return json({ error: error?.message ?? "Could not create the job" }, 500);
        requestId = created.id;
      }
      await db.from("website_demo_requests").update({ generation_status: "queued", generation_error: null, template }).eq("id", requestId);
      // Generation takes a minute or two; answer now and keep working.
      const job = runGeneration(db, requestId!, template);
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
      if (runtime) runtime.waitUntil(job);
      else await job;
      return json({ request_id: requestId, status: "queued", template });
    }

    if (action === "rerender") {
      const template = pickTemplate(payload.template);
      const { data: site, error } = await db.from("websites").select("id, content").eq("id", payload.website_id).single();
      if (error || !site) return json({ error: "Website not found" }, 404);
      if (!site.content) return json({ error: "This site was published by hand; there is no generated content to re-render." }, 400);
      const html = renderSite(template, site.content as SiteContent);
      const { error: upErr } = await db.from("websites").update({ html, template, updated_at: new Date().toISOString() }).eq("id", site.id);
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ ok: true, template });
    }

    if (action === "update") {
      const fields: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (Array.isArray(payload.claim_emails)) {
        fields.claim_emails = payload.claim_emails.map((e: unknown) => String(e).trim().toLowerCase()).filter((e: string) => /^\S+@\S+\.\S+$/.test(e)).slice(0, 10);
      }
      if (typeof payload.claim_domain === "string") fields.claim_domain = payload.claim_domain.trim().toLowerCase() || null;
      if (typeof payload.name === "string" && payload.name.trim()) fields.name = payload.name.trim().slice(0, 200);
      if (typeof payload.showcase === "boolean") fields.showcase = payload.showcase;
      if (typeof payload.extend_days === "number" && payload.extend_days > 0) {
        fields.demo_expires_at = new Date(Date.now() + Math.min(payload.extend_days, 180) * 86400_000).toISOString();
      }
      const { error } = await db.from("websites").update(fields).eq("id", payload.website_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "request_status") {
      const status = String(payload.status);
      if (!["new", "in_progress", "demo_sent", "claimed", "declined"].includes(status)) return json({ error: "Invalid status" }, 400);
      const { error } = await db.from("website_demo_requests").update({ status }).eq("id", payload.request_id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "delete") {
      const { data: site } = await db.from("websites").select("id, account_id").eq("id", payload.website_id).single();
      if (!site) return json({ error: "Website not found" }, 404);
      if (site.account_id) return json({ error: "This website has been claimed by a customer and can't be deleted here." }, 400);
      const { error } = await db.from("websites").delete().eq("id", site.id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    if (action === "analytics") {
      const { data, error } = await db.rpc("get_website_analytics", { p_website_id: payload.website_id, p_days: Number(payload.days) || 30 });
      if (error) return json({ error: error.message }, 500);
      return json({ analytics: data });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    console.error("admin-websites error:", err);
    return json({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
