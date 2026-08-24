import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function respond(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type ContactRow = {
  contact_email: string;
  contact_name: string | null;
  last_active_at: string;
  role_titles: string[] | null;
  employment_types: string[] | null;
  work_types: string[] | null;
  visa_types: string[] | null;
  experience_years: number[] | null;
  skills: string[] | null;
  locations: string[] | null;
  hourly_rate_min: number[] | null;
  hourly_rate_max: number[] | null;
  post_count: number | null;
};

type ActiveListContact = {
  name: string;
  email: string;
  last_active_at: string;
  role_titles: string;
  role_titles_list: string[];
  employment_types: string[];
  work_types: string[];
  visa_types: string[];
  experience_years: number[];
  skills: string[];
  locations: string[];
  hourly_rate_min: number[];
  hourly_rate_max: number[];
  post_count: number;
};

// Matches /jobs' PROFILE_RANGE_OPTIONS. Clamped to this allow-list so the
// caller can't request an arbitrarily large window.
const ALLOWED_HOURS_BACK = [24, 72, 168, 360, 720];
const DEFAULT_HOURS_BACK = 72;

const ROW_RPC_BY_DOWNLOAD_TYPE: Record<string, string> = {
  vendors: "get_active_list_vendor_contacts_24h",
  recruiters: "get_active_list_recruiter_contacts_24h",
};

type DownloadGateRow = { allowed_count: number; is_free_plan: boolean; lifetime_downloaded: number; message: string };

function mapRows(rows: ContactRow[] | null): ActiveListContact[] {
  return (rows ?? []).map((row) => ({
    name: row.contact_name ?? "",
    email: row.contact_email,
    last_active_at: row.last_active_at,
    role_titles: (row.role_titles ?? []).join(", "),
    role_titles_list: row.role_titles ?? [],
    employment_types: row.employment_types ?? [],
    work_types: row.work_types ?? [],
    visa_types: row.visa_types ?? [],
    experience_years: row.experience_years ?? [],
    skills: row.skills ?? [],
    locations: row.locations ?? [],
    hourly_rate_min: row.hourly_rate_min ?? [],
    hourly_rate_max: row.hourly_rate_max ?? [],
    post_count: row.post_count ?? 0,
  }));
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (request.method !== "POST" && request.method !== "GET") return respond({ error: "Method not allowed" }, 405);

  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return respond({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
  });

  try {
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) return respond({ error: "Unauthorized" }, 401);

    const body = await request.json().catch(() => ({}));
    const requestedHours = Number(body?.hours_back);
    const hoursBack = ALLOWED_HOURS_BACK.includes(requestedHours) ? requestedHours : DEFAULT_HOURS_BACK;

    const supabaseAdmin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // download_type is set only by the public preview pages' "download full
    // list" action. When present, this is a download — gate it against the
    // free-plan lifetime limit (check_and_log_active_list_download) and
    // return only that one list, capped to what the account is allowed.
    // When absent (ActiveListPage.tsx's on-mount/filter-change fetch, which
    // populates the on-screen browsable table), behavior is unchanged: both
    // lists, full data, no capping — the ask was to limit downloads, not
    // in-app browsing.
    const downloadType = body?.download_type;
    if (downloadType === "vendors" || downloadType === "recruiters") {
      const rowsRes = await supabaseAdmin.rpc(ROW_RPC_BY_DOWNLOAD_TYPE[downloadType], { p_hours_back: hoursBack });
      if (rowsRes.error) throw rowsRes.error;
      const allRows = mapRows(rowsRes.data as ContactRow[]);

      // Called via supabaseUser (forwarded caller JWT), not supabaseAdmin —
      // the RPC derives the caller's account from auth.uid() internally,
      // which only resolves when the call is made as the actual user.
      const gateRes = await supabaseUser.rpc("check_and_log_active_list_download", {
        p_requested_count: allRows.length,
        p_download_type: downloadType,
      });
      if (gateRes.error) throw gateRes.error;
      const gateRow = (Array.isArray(gateRes.data) ? gateRes.data[0] : null) as DownloadGateRow | null;
      if (!gateRow) return respond({ error: "Could not verify download limit" }, 500);

      const slicedRows = allRows.slice(0, gateRow.allowed_count);
      return respond({
        [downloadType]: slicedRows,
        limited: gateRow.allowed_count < allRows.length,
        lifetime_downloaded: gateRow.lifetime_downloaded,
        message: gateRow.message,
      });
    }

    const [recruitersRes, vendorsRes] = await Promise.all([
      supabaseAdmin.rpc("get_active_list_recruiter_contacts_24h", { p_hours_back: hoursBack }),
      supabaseAdmin.rpc("get_active_list_vendor_contacts_24h", { p_hours_back: hoursBack }),
    ]);

    if (recruitersRes.error) throw recruitersRes.error;
    if (vendorsRes.error) throw vendorsRes.error;

    return respond({
      recruiters: mapRows(recruitersRes.data as ContactRow[]),
      vendors: mapRows(vendorsRes.data as ContactRow[]),
    });
  } catch (error) {
    console.error("active-list error", error);
    return respond({ error: "Internal server error" }, 500);
  }
});
