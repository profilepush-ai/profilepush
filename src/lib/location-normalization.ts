import { supabase } from './supabase';

interface PlacesSuggestion {
  placeId: string;
}

interface PlacesDetails {
  formatted?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  country?: string;
  countryCode?: string;
}

function getPlacesFunctionUrl() {
  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  return supabaseUrl ? `${supabaseUrl}/functions/v1/google-places` : '';
}

function buildLocationSeed(location?: string, city?: string, state?: string, country?: string) {
  const loc = (location ?? '').trim();
  if (loc) return loc;
  const parts = [city, state, country].map(v => (v ?? '').trim()).filter(Boolean);
  return parts.join(', ');
}

function looksLikeLocationList(text: string) {
  return /[;|]/.test(text) || /\s+\+\s+/.test(text);
}

export function splitPreferredLocations(value: string) {
  const raw = value.trim();
  if (!raw) return [] as string[];
  const delimiter = raw.includes('|') ? '|' : raw.includes(';') ? ';' : raw.includes('\n') ? '\n' : null;
  if (!delimiter) return [raw];
  return raw.split(delimiter).map(item => item.trim()).filter(Boolean);
}

export function firstPreferredLocation(value: string) {
  const items = splitPreferredLocations(value);
  return items[0] ?? '';
}

async function normalizePlaceInput(
  input: string,
  scope: 'any' | 'city' | 'state' | 'country' = 'any',
): Promise<PlacesDetails | null> {
  const query = input.trim();
  const endpoint = getPlacesFunctionUrl();
  if (!query || !endpoint) return null;

  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? '';
  if (!accessToken) return null;

  const supabaseAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };
  if (supabaseAnon) headers.Apikey = supabaseAnon;

  const autocompleteRes = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'autocomplete', input: query, scope }),
  });
  if (!autocompleteRes.ok) return null;

  const autocompleteData = await autocompleteRes.json();
  const suggestions = Array.isArray(autocompleteData?.suggestions)
    ? (autocompleteData.suggestions as PlacesSuggestion[])
    : [];
  const first = suggestions[0];
  if (!first?.placeId) return null;

  const detailsRes = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ mode: 'details', placeId: first.placeId }),
  });
  if (!detailsRes.ok) return null;

  const detailsData = await detailsRes.json();
  return (detailsData?.place as PlacesDetails | undefined) ?? null;
}

export async function normalizeProfileLocationFields<T extends Record<string, unknown>>(payload: T): Promise<T> {
  const next = { ...payload } as Record<string, unknown>;

  const rawLocation = String(next.location ?? '').trim();
  const rawCity = String(next.city ?? '').trim();
  const rawState = String(next.state ?? '').trim();
  const rawCountry = String(next.country ?? '').trim();
  const seed = buildLocationSeed(rawLocation, rawCity, rawState, rawCountry);

  if (seed) {
    const normalized = await normalizePlaceInput(seed, 'any');
    if (normalized) {
      next.location = normalized.formatted || seed;
      next.city = normalized.city || rawCity;
      next.state = normalized.stateCode || normalized.state || rawState;
      next.country = normalized.countryCode || normalized.country || rawCountry;
    }
  }

  const rawPreferred = String(next.preferred_locations ?? '').trim();
  if (rawPreferred && !looksLikeLocationList(rawPreferred)) {
    const normalizedPreferred = await normalizePlaceInput(rawPreferred, 'any');
    if (normalizedPreferred?.formatted) {
      next.preferred_locations = normalizedPreferred.formatted;
    }
  }

  return next as T;
}