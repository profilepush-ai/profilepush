import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type AutocompleteRequest = {
  mode: "autocomplete";
  input: string;
  sessionToken?: string;
  scope?: "any" | "city" | "state" | "country";
};

type DetailsRequest = {
  mode: "details";
  placeId: string;
};

type PlacesRequest = AutocompleteRequest | DetailsRequest;

const CITY_TYPES = new Set(["locality", "postal_town"]);
const STATE_TYPES = new Set(["administrative_area_level_1"]);
const COUNTRY_TYPES = new Set(["country"]);

function hasAnyType(types: string[], allowed: Set<string>) {
  return types.some((type) => allowed.has(type));
}

function pickAddressComponent(
  comps: Array<{ longText?: string; shortText?: string; long_name?: string; short_name?: string; types?: string[] }>,
  type: string,
) {
  return comps.find((c) => Array.isArray(c.types) && c.types.includes(type));
}

function normalizeDetails(place: Record<string, unknown>) {
  const rawComps = (place.addressComponents ?? place.address_components) as unknown;
  const comps = Array.isArray(rawComps)
    ? (rawComps as Array<{ longText?: string; shortText?: string; long_name?: string; short_name?: string; types?: string[] }>)
    : [];

  const cityComp = pickAddressComponent(comps, "locality") ?? pickAddressComponent(comps, "administrative_area_level_2");
  const city = cityComp?.longText
    ?? cityComp?.long_name
    ?? "";

  const stateComp = pickAddressComponent(comps, "administrative_area_level_1");
  const countryComp = pickAddressComponent(comps, "country");

  const geometry = (place.geometry as Record<string, unknown> | undefined) ?? {};
  const geoLocation = (geometry.location as Record<string, unknown> | undefined) ?? {};
  const location = (place.location as Record<string, unknown> | undefined) ?? geoLocation;

  return {
    placeId: String(place.id ?? ""),
    formatted: String(place.formattedAddress ?? place.formatted_address ?? ""),
    city,
    state: stateComp?.longText ?? stateComp?.long_name ?? "",
    stateCode: stateComp?.shortText ?? stateComp?.short_name ?? "",
    country: countryComp?.longText ?? countryComp?.long_name ?? "",
    countryCode: countryComp?.shortText ?? countryComp?.short_name ?? "",
    lat: typeof location.latitude === "number"
      ? location.latitude
      : typeof location.lat === "number"
      ? location.lat
      : null,
    lng: typeof location.longitude === "number"
      ? location.longitude
      : typeof location.lng === "number"
      ? location.lng
      : null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "Missing GOOGLE_PLACES_API_KEY in function secrets." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = (await req.json()) as PlacesRequest;

    if (body.mode === "autocomplete") {
      const input = String(body.input ?? "").trim();
      if (!input) {
        return new Response(JSON.stringify({ suggestions: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
      url.searchParams.set("input", input);
      const scope = body.scope ?? "any";
      if (scope === "city") {
        url.searchParams.set("types", "(cities)");
      } else if (scope === "state" || scope === "country" || scope === "any") {
        url.searchParams.set("types", "(regions)");
      }
      url.searchParams.set("key", apiKey);
      if (body.sessionToken) url.searchParams.set("sessiontoken", body.sessionToken);

      const response = await fetch(url.toString(), { method: "GET" });

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data }), {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const predictions = Array.isArray(data?.predictions) ? data.predictions : [];
      const suggestions = predictions.length
        ? predictions
            .map((pred: Record<string, unknown>) => {
              const formatting = pred.structured_formatting as Record<string, unknown> | undefined;
              return {
                placeId: String(pred.place_id ?? ""),
                text: String(pred.description ?? ""),
                mainText: String(formatting?.main_text ?? ""),
                secondaryText: String(formatting?.secondary_text ?? ""),
                types: Array.isArray(pred.types) ? pred.types : [],
              };
            })
            .filter((item: Record<string, unknown>) => Boolean(item.placeId))
        : [];

      const filtered = suggestions.filter((s: Record<string, unknown>) => {
        const types = Array.isArray(s.types) ? (s.types as string[]) : [];
        if (scope === "any") {
          return hasAnyType(types, CITY_TYPES) || hasAnyType(types, STATE_TYPES) || hasAnyType(types, COUNTRY_TYPES);
        }
        if (scope === "city") {
          return hasAnyType(types, CITY_TYPES);
        }
        if (scope === "state") {
          return hasAnyType(types, STATE_TYPES);
        }
        if (scope === "country") {
          return hasAnyType(types, COUNTRY_TYPES);
        }
        return true;
      });

      return new Response(JSON.stringify({ suggestions: filtered }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.mode === "details") {
      const placeId = String(body.placeId ?? "").trim();
      if (!placeId) {
        return new Response(JSON.stringify({ error: "placeId is required for details mode." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
      url.searchParams.set("place_id", placeId);
      url.searchParams.set("fields", "place_id,formatted_address,address_component,geometry");
      url.searchParams.set("key", apiKey);

      const response = await fetch(url.toString(), { method: "GET" });

      const data = await response.json();
      if (!response.ok) {
        return new Response(JSON.stringify({ error: data }), {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const result = (data?.result ?? null) as Record<string, unknown> | null;
      if (!result) {
        return new Response(JSON.stringify({ error: data }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ place: normalizeDetails(result) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid mode. Use autocomplete or details." }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
