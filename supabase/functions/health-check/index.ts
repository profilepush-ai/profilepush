// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "@supabase/functions-js/edge-runtime.d.ts";
import { withSupabase } from "@supabase/server";

export default {
  fetch: withSupabase({ auth: ["publishable", "secret"] }, async (req, ctx) => {
    if (req.method === "GET") {
      return Response.json({
        ok: true,
        function: "health-check",
        auth_mode: ctx.authMode,
        timestamp: new Date().toISOString(),
      });
    }

    let name = "ProfilePush";
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.name === "string" && body.name.trim().length > 0) {
        name = body.name.trim();
      }
    }

    return Response.json({
      ok: true,
      function: "health-check",
      message: `Hello ${name}!`,
      auth_mode: ctx.authMode,
      timestamp: new Date().toISOString(),
    });
  }),
};

/* To invoke locally:

  1. Run `supabase start` (see: https://supabase.com/docs/reference/cli/supabase-start)
  2. Make an HTTP request:

  curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/health-check' \
    --header 'apiKey: sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH' \
    --data '{"name":"Functions"}'

*/
