import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Connect a customer's own domain to their website (Cloudflare for SaaS
// custom hostnames). Members of the owning account only.
//
//   connect { website_id, domain }   register it; returns the DNS records to add
//   status  { website_id }           re-check with Cloudflare; activates when ready
//   remove  { website_id }
//
// Env: CF_SAAS_API_TOKEN (Zone: SSL and Certificates edit, Custom Hostnames
// edit), CF_SAAS_ZONE_ID (the zone that owns the fallback origin), and
// SITES_CNAME_TARGET (what customers point their CNAME at).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const DOMAIN = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

type CfHostname = {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string; validation_records?: { txt_name?: string; txt_value?: string }[] };
  ownership_verification?: { type?: string; name?: string; value?: string };
  verification_errors?: string[];
};

async function cf(path: string, init: RequestInit = {}): Promise<CfHostname> {
  const zone = Deno.env.get("CF_SAAS_ZONE_ID");
  const token = Deno.env.get("CF_SAAS_API_TOKEN");
  if (!zone || !token) throw new Error("Custom domains are not set up yet. Contact ProfilePush and we'll connect it for you.");
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${zone}/custom_hostnames${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const body = await res.json() as { success: boolean; errors?: { message: string }[]; result: CfHostname };
  if (!body.success) throw new Error(body.errors?.map(e => e.message).join("; ") || `Cloudflare returned ${res.status}`);
  return body.result;
}

// What the customer adds at their DNS provider.
function instructions(h: CfHostname | null, domain: string) {
  const target = Deno.env.get("SITES_CNAME_TARGET") ?? "customers.profilepush.ai";
  const records: { type: string; name: string; value: string }[] = [{ type: "CNAME", name: domain, value: target }];
  if (h?.ownership_verification?.name && h.ownership_verification.value && h.status !== "active") {
    records.push({ type: "TXT", name: h.ownership_verification.name, value: h.ownership_verification.value });
  }
  for (const v of h?.ssl?.validation_records ?? []) {
    if (v.txt_name && v.txt_value && h?.ssl?.status !== "active") records.push({ type: "TXT", name: v.txt_name, value: v.txt_value });
  }
  return records;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return respond({ error: "Unauthorized" }, 401);

    const { action, website_id, domain: rawDomain } = await req.json();
    if (typeof website_id !== "string") return respond({ error: "website_id is required" }, 400);

    // RLS: only members of the owning account can see the site.
    const { data: member } = await userClient.rpc("is_website_member", { p_website_id: website_id });
    if (member !== true) return respond({ error: "Not allowed" }, 403);

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: site } = await admin.from("websites").select("id, custom_domain, cf_hostname_id, domain_status").eq("id", website_id).single();
    if (!site) return respond({ error: "Website not found" }, 404);

    if (action === "connect") {
      const domain = String(rawDomain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      if (!DOMAIN.test(domain)) return respond({ error: "Enter a domain like www.yourcompany.com." }, 400);
      if (domain.endsWith("profilepush.ai")) return respond({ error: "Use your own company domain." }, 400);
      const { data: taken } = await admin.from("websites").select("id").eq("custom_domain", domain).neq("id", website_id).maybeSingle();
      if (taken) return respond({ error: "That domain is already connected to another website." }, 400);

      if (site.cf_hostname_id) await cf(`/${site.cf_hostname_id}`, { method: "DELETE" }).catch(() => {});
      const h = await cf("", {
        method: "POST",
        body: JSON.stringify({ hostname: domain, ssl: { method: "txt", type: "dv", settings: { min_tls_version: "1.2" } } }),
      });
      await admin.from("websites").update({ custom_domain: domain, cf_hostname_id: h.id, domain_status: "pending", updated_at: new Date().toISOString() }).eq("id", website_id);
      return respond({ domain, status: "pending", records: instructions(h, domain) });
    }

    if (action === "status") {
      if (!site.cf_hostname_id || !site.custom_domain) return respond({ domain: null, status: null, records: [] });
      const h = await cf(`/${site.cf_hostname_id}`);
      const status = h.status === "active" && h.ssl?.status === "active"
        ? "active"
        : ["moved", "deleted", "blocked"].includes(h.status) ? "failed" : "pending";
      if (status !== site.domain_status) {
        await admin.from("websites").update({ domain_status: status, updated_at: new Date().toISOString() }).eq("id", website_id);
      }
      return respond({ domain: site.custom_domain, status, records: status === "active" ? [] : instructions(h, site.custom_domain), errors: h.verification_errors ?? [] });
    }

    if (action === "remove") {
      if (site.cf_hostname_id) await cf(`/${site.cf_hostname_id}`, { method: "DELETE" }).catch(() => {});
      await admin.from("websites").update({ custom_domain: null, cf_hostname_id: null, domain_status: null, updated_at: new Date().toISOString() }).eq("id", website_id);
      return respond({ ok: true });
    }

    return respond({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("website-domain error:", err);
    return respond({ error: err instanceof Error ? err.message : "Internal server error" }, 500);
  }
});
