// Text helpers for sources without structured pay, type or location fields.

export const US_STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut",
  DE: "Delaware", DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois",
  IN: "Indiana", IA: "Iowa", KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri", MT: "Montana",
  NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico", NY: "New York",
  NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania",
  RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming", PR: "Puerto Rico",
};
export const US_STATES = new Set(Object.keys(US_STATE_NAMES));
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATE_NAMES).map(([k, v]) => [v.toLowerCase(), k]));
export const CA_PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);
const NON_US_WORDS = /\b(canada|india|mexico|united kingdom|uk|ontario|quebec|alberta|british columbia|toronto|montreal|vancouver|calgary|ottawa|bangalore|bengaluru|hyderabad|chennai|pune|noida|gurgaon)\b/i;

const NUM = String.raw`\$?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?`;
const PAY_RE = new RegExp(
  String.raw`(?:pay|rate|salary|compensation|payrange|pay range|bill rate|hourly)[^$\n]{0,40}?\$\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?` +
    String.raw`(?:\s*(?:-|–|to)\s*` + NUM + String.raw`)?\s*(?:/|per\s+|an?\s+)?\s*(hr|hour|hourly|h\b|yr|year|annual|annually|annum|month|week|day)?`,
  "i",
);
const PAY_RE_LOOSE = new RegExp(
  String.raw`\$\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*([kK])?(?:\s*(?:-|–|to)\s*` + NUM + String.raw`)?\s*(?:/|per\s+|an?\s+)\s*(hr|hour|yr|year|annum|annually)`,
  "i",
);

const amount = (x: string, k?: string) => Number(x.replace(/,/g, "")) * (k ? 1000 : 1);

export function parsePay(text: string | null | undefined): { min: number | null; max: number | null; unit: string | null } {
  const none = { min: null, max: null, unit: null };
  if (!text) return none;
  const m = text.match(PAY_RE) ?? text.match(PAY_RE_LOOSE);
  if (!m) return none;
  const lo = amount(m[1], m[2]);
  const hi = m[3] ? amount(m[3], m[4]) : lo;
  const u = (m[5] ?? "").toLowerCase();
  let unit: string | null;
  if (["hr", "hour", "hourly", "h"].includes(u)) unit = "HOUR";
  else if (["yr", "year", "annual", "annually", "annum"].includes(u)) unit = "YEAR";
  else if (u) unit = u.toUpperCase();
  else unit = lo < 500 ? "HOUR" : lo >= 20000 ? "YEAR" : null;
  if (lo <= 1 || hi < lo) return none;
  return { min: lo, max: hi, unit };
}

const ET_RULES: Array<[RegExp, string]> = [
  [/\bcontract[\s-]*to[\s-]*hire\b|\bc2h\b|\btemp[\s-]*to[\s-]*perm/i, "Contract-to-hire"],
  [/\b(full[\s-]*time\s+(?:employee|position|role|permanent)|permanent|direct[\s-]*hire|\bFTE\b)/i, "Full-time"],
  [/\bc2c\b|corp[\s-]*to[\s-]*corp|\bW2\b|\bcontract(?:or)?\b|\bduration\s*:/i, "Contract"],
];

export function guessEmploymentType(text: string | null | undefined): string | null {
  const head = (text ?? "").slice(0, 1500);
  const m = head.match(/(?:job|position|employment|engagement)?\s*type\s*:\s*([A-Za-z0-9 /-]{3,40})/i);
  if (m) {
    const v = m[1].trim().split(/\s{2,}|\s+(?:rate|location|duration|pay|position|title|client|job|work|start)\b/i)[0];
    if (v) return v.trim();
  }
  for (const [rx, label] of ET_RULES) if (rx.test(head)) return label;
  return null;
}

export function parseUsLocation(raw: string | null | undefined) {
  const s = (raw ?? "").replace(/ /g, " ").trim();
  const remote = /\bremote\b/i.test(s);
  if (NON_US_WORDS.test(s)) return { city: s || null, state: null as string | null, country: null as string | null, remote, nonUs: true };
  const parts = s.split(/[,|]/).map((p) => p.trim()).filter((p) => p && !["usa", "us", "united states", "united states of america"].includes(p.toLowerCase()));
  let state: string | null = null;
  let city: string | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const tok = parts[i].replace(/\(.*?\)|\d{5}(-\d{4})?/g, "").trim();
    const w = tok.split(/\s+/);
    if (US_STATES.has(tok.toUpperCase())) state = tok.toUpperCase();
    else if (STATE_BY_NAME[tok.toLowerCase()]) state = STATE_BY_NAME[tok.toLowerCase()];
    else if (w[0] && w[0].length === 2 && w[0] === w[0].toUpperCase() && US_STATES.has(w[0])) state = w[0];
    else if (tok.length === 2 && CA_PROVINCES.has(tok.toUpperCase())) return { city: i > 0 ? parts[0] : null, state: tok.toUpperCase(), country: "CA", remote, nonUs: true };
    else if (w.length > 1 && w[w.length - 1].length === 2 && w[w.length - 1] === w[w.length - 1].toUpperCase() && US_STATES.has(w[w.length - 1])) {
      state = w[w.length - 1];
      city = w.slice(0, -1).join(" ") || null;
    }
    if (state) {
      if (city === null && i > 0) city = parts[i - 1];
      break;
    }
  }
  if (city === null && state === null && parts.length > 0 && !remote) city = parts[0];
  const country = state || remote || /\bUSA?\b|United States/.test(s) ? "US" : null;
  return { city, state, country, remote, nonUs: false };
}

export const ymd = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().slice(0, 10) : null);
export const positive = (x: unknown) => {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// The JSON object starting at `start` (first "{" at or after it), matched by
// braces outside strings, like Python's JSONDecoder.raw_decode.
export function readJsonObject(text: string, start: number): unknown {
  const open = text.indexOf("{", start);
  if (open < 0) throw new Error("no object");
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(open, i + 1));
  }
  throw new Error("unterminated object");
}
