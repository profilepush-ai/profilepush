// Admin composer: write a post once, publish it to every connected network.
//
// Publishing goes through Buffer's GraphQL API rather than each network's own
// API. That is the whole point: Buffer already holds approved Facebook and
// LinkedIn apps, so posting to a company page needs no Meta app review and no
// LinkedIn Community Management API approval — you connect the accounts once
// in Buffer's dashboard and this function posts to them by channel id.
//
// Buffer's free plan covers this: one API key, 3,000 requests per 30 days and
// three channels, against roughly one request per post here.
//
// Password-gated like every other admin-* function. The API key lives in a
// function secret, never in the database and never in the browser.
//
// Each channel is published in its own request and its outcome recorded, so
// one failure does not hide the others and can be retried on its own. Without
// that, the common case — one channel's Buffer connection expiring — reads as
// a total failure, gets reposted, and duplicates the channels that worked.

import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD") || "profilepush2024";
const BUFFER_API = "https://api.buffer.com";

type ChannelResult = { ok: boolean; id?: string; error?: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function buffer<T>(query: string, variables: Record<string, unknown> = {}): Promise<{ data?: T; error?: string }> {
  const key = Deno.env.get("BUFFER_API_KEY");
  if (!key) return { error: "BUFFER_API_KEY is not set on this function" };

  const res = await fetch(BUFFER_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  if (!res.ok) return { error: `Buffer HTTP ${res.status}: ${text.slice(0, 300)}` };

  let parsed: { data?: T; errors?: Array<{ message?: string }> };
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: `Buffer returned non-JSON: ${text.slice(0, 200)}` };
  }
  // GraphQL reports failures with HTTP 200 and an errors array, so a status
  // check alone would treat a rejected mutation as a success.
  if (parsed.errors?.length) return { error: parsed.errors.map((e) => e.message).join("; ") };
  return { data: parsed.data };
}

type BufferChannel = {
  id: string;
  service?: string;
  name?: string;
  displayName?: string;
  isDisconnected?: boolean;
  isLocked?: boolean;
};

// Resolved from the key rather than configured. The key belongs to exactly
// one Buffer account, so asking for an organization id as well is a second
// thing to get wrong for no benefit. BUFFER_ORGANIZATION_ID still overrides,
// for an account that belongs to more than one organization.
async function resolveOrganizationId(): Promise<{ orgId?: string; error?: string }> {
  const configured = Deno.env.get("BUFFER_ORGANIZATION_ID");
  if (configured) return { orgId: configured };

  const { data, error } = await buffer<{ account?: { organizations?: Array<{ id: string }> } }>(
    `{ account { organizations { id } } }`,
  );
  if (error) return { error };
  const orgId = data?.account?.organizations?.[0]?.id;
  if (!orgId) return { error: "This Buffer account has no organization" };
  return { orgId };
}

async function listChannels(): Promise<{ channels: BufferChannel[]; error?: string }> {
  const { orgId, error: orgError } = await resolveOrganizationId();
  if (orgError || !orgId) return { channels: [], error: orgError };

  // organizationId is typed OrganizationId!, not String! — declaring it as a
  // String fails variable-type validation before the query runs.
  const { data, error } = await buffer<{ channels: BufferChannel[] }>(
    `query Channels($orgId: OrganizationId!) {
       channels(input: { organizationId: $orgId }) {
         id service name displayName isDisconnected isLocked
       }
     }`,
    { orgId },
  );
  if (error) return { channels: [], error };
  // A disconnected channel still lists; posting to it fails with an
  // authorization error that reads like a bug in this function.
  return { channels: (data?.channels ?? []).filter((c) => !c.isDisconnected) };
}

type PostResponse = {
  createPost: {
    __typename?: string;
    post?: { id?: string };
    message?: string;
    code?: string;
  };
};

// One post, one channel. Buffer takes a single channelId per createPost, so
// fanning out is this function's job rather than Buffer's.
async function publishToChannel(
  channelId: string,
  text: string,
  imageUrl: string | null,
): Promise<ChannelResult> {
  const input: Record<string, unknown> = {
    text,
    channelId,
    schedulingType: "automatic",
    // shareNow publishes immediately; addToQueue would sit in Buffer's
    // schedule until its next slot, which is not what "Publish" implies.
    mode: "shareNow",
    // Both required by the schema. needsApproval omitted fails validation
    // outright, and assets is a non-null list, so a text post sends [].
    needsApproval: false,
    assets: imageUrl ? [{ image: { url: imageUrl } }] : [],
  };

  const { data, error } = await buffer<PostResponse>(
    `mutation CreatePost($input: CreatePostInput!) {
       createPost(input: $input) {
         __typename
         ... on PostActionSuccess { post { id } }
         ... on MutationError { message }
         ... on RestProxyError { code }
       }
     }`,
    { input },
  );
  if (error) return { ok: false, error };

  const result = data?.createPost;
  // Errors arrive as a union member inside a 200, not as a GraphQL error, so
  // "no errors array" is not success — the absence of a post id is what says
  // it failed. __typename is carried into the message because
  // LimitReachedError and UnauthorizedError need completely different fixes
  // and both otherwise read as "something went wrong".
  if (!result?.post?.id) {
    const kind = result?.__typename && result.__typename !== "PostActionSuccess" ? `${result.__typename}: ` : "";
    return { ok: false, error: `${kind}${result?.message ?? "Buffer returned no post id"}` };
  }
  return { ok: true, id: result.post.id };
}

async function publish(
  supabase: ReturnType<typeof createClient>,
  postId: string,
  body: string,
  linkUrl: string | null,
  imageUrl: string | null,
  channelIds: string[],
) {
  await supabase.from("admin_social_posts").update({ status: "publishing" }).eq("id", postId);

  // Buffer linkifies a URL found in the text and builds the preview card from
  // it, so the link belongs in the body rather than in a separate field.
  const text = linkUrl && !body.includes(linkUrl) ? `${body}\n\n${linkUrl}` : body;

  const entries = await Promise.all(
    channelIds.map(async (channelId): Promise<[string, ChannelResult]> => {
      try {
        return [channelId, await publishToChannel(channelId, text, imageUrl)];
      } catch (err) {
        return [channelId, { ok: false, error: (err as Error).message }];
      }
    }),
  );
  const results = Object.fromEntries(entries) as Record<string, ChannelResult>;

  const okCount = Object.values(results).filter((r) => r.ok).length;
  const status = okCount === channelIds.length ? "posted" : okCount > 0 ? "partial" : "failed";

  await supabase.from("admin_social_posts")
    .update({ status, results, posted_at: okCount > 0 ? new Date().toISOString() : null })
    .eq("id", postId);

  return { status, results };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const payload = await req.json();
    if (payload.password !== ADMIN_PASSWORD) return jsonResponse({ error: "Invalid password" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const action = String(payload.action ?? "list");

    // The UI renders whatever is connected in Buffer rather than a hardcoded
    // list, so connecting a new account there makes it postable here with no
    // deploy. The error is returned rather than thrown so the panel can show
    // what is actually wrong (missing key, wrong org id, expired plan).
    if (action === "channels") {
      const { channels, error } = await listChannels();
      return jsonResponse({ channels, error: error ?? null });
    }

    if (action === "list") {
      const { data, error } = await supabase
        .from("admin_social_posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(Math.min(Number(payload.limit ?? 30), 100));
      if (error) throw new Error(error.message);
      return jsonResponse({ posts: data ?? [] });
    }

    if (action === "publish") {
      const body = String(payload.body ?? "").trim();
      const channelIds: string[] = (Array.isArray(payload.channels) ? payload.channels : [])
        .map((c: unknown) => String(c)).filter(Boolean);
      if (!body) return jsonResponse({ error: "Post body is empty" }, 400);
      if (!channelIds.length) return jsonResponse({ error: "Pick at least one channel" }, 400);

      const linkUrl = payload.link_url ? String(payload.link_url).trim() : null;
      const imageUrl = payload.image_url ? String(payload.image_url).trim() : null;
      // Stored so history stays readable after a channel is renamed or
      // disconnected in Buffer, when the id alone would mean nothing.
      const labels = (payload.channel_labels ?? {}) as Record<string, string>;

      const { data: row, error } = await supabase
        .from("admin_social_posts")
        .insert({
          body,
          link_url: linkUrl,
          image_url: imageUrl,
          channels: channelIds,
          channel_labels: labels,
          status: "draft",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);

      const outcome = await publish(supabase, row.id, body, linkUrl, imageUrl, channelIds);
      return jsonResponse({ id: row.id, ...outcome });
    }

    // Retries only the channels that failed, so a partial success is never
    // duplicated on the ones that already published.
    if (action === "retry") {
      const { data: row, error } = await supabase
        .from("admin_social_posts")
        .select("*")
        .eq("id", String(payload.id))
        .single();
      if (error || !row) return jsonResponse({ error: "Post not found" }, 404);

      const previous = (row.results ?? {}) as Record<string, ChannelResult>;
      const pending = (row.channels as string[]).filter((c) => !previous[c]?.ok);
      if (!pending.length) return jsonResponse({ error: "Every channel already posted" }, 400);

      const outcome = await publish(supabase, row.id, row.body, row.link_url, row.image_url, pending);
      const merged = { ...previous, ...outcome.results };
      const okCount = (row.channels as string[]).filter((c) => merged[c]?.ok).length;
      const status = okCount === row.channels.length ? "posted" : okCount > 0 ? "partial" : "failed";
      await supabase.from("admin_social_posts").update({ results: merged, status }).eq("id", row.id);
      return jsonResponse({ id: row.id, status, results: merged });
    }

    if (action === "delete") {
      // Removes the record only. Anything already published stays on the
      // network — deleting there is a different and riskier operation than
      // clearing a row of history.
      await supabase.from("admin_social_posts").delete().eq("id", String(payload.id));
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    return jsonResponse({ error: (err as Error).message }, 500);
  }
});
