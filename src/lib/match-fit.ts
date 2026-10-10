// How a job and a profile fit, in the pieces the match cards draw: skills
// (which of the job's skills the profile has), visa, location and rate.
// The match % itself comes from the server; these explain it.

// ---------- skills ----------

const SKILL_SYNONYMS: Record<string, string> = {
  'reactjs': 'react', 'react.js': 'react', 'react js': 'react',
  'nodejs': 'node', 'node.js': 'node', 'node js': 'node',
  'vuejs': 'vue', 'vue.js': 'vue', 'angularjs': 'angular',
  'k8s': 'kubernetes', 'amazon web services': 'aws', 'google cloud': 'gcp', 'google cloud platform': 'gcp',
  'microsoft azure': 'azure', 'js': 'javascript', 'ts': 'typescript', 'golang': 'go',
  'postgres': 'postgresql', 'ms sql': 'sql server', 'mssql': 'sql server', 'dotnet': '.net', 'asp.net': '.net',
  'springboot': 'spring boot', 'micro services': 'microservices', 'ci/cd': 'cicd', 'ci cd': 'cicd',
  'power bi': 'powerbi', 'ml': 'machine learning', 'ai/ml': 'machine learning',
};

export function normSkill(raw: string): string {
  const s = raw.toLowerCase().replace(/[^a-z0-9+#./ ]+/g, ' ').replace(/\s+/g, ' ').trim();
  return SKILL_SYNONYMS[s] ?? s;
}

const wordIn = (needle: string, hay: string) => new RegExp(`(^|[^a-z0-9+#])${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9+#])`).test(hay);

const STOP = new Set(['and', 'or', 'of', 'the', 'with', 'in', 'for', 'to', 'on', 'experience', 'knowledge', 'skills', 'strong', 'good', 'tools', 'support']);
const stem = (w: string) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokens = (s: string) => s.split(/[\s/,&-]+/).map(stem).filter((w) => w.length >= 2 && !STOP.has(w));

// Same skill in other words: one's words inside the other's, or most of them shared.
function sameSkill(a: string, b: string): boolean {
  if (a === b) return true;
  if ((a.length >= 3 && wordIn(a, b)) || (b.length >= 3 && wordIn(b, a))) return true;
  const ta = tokens(a), tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const shared = ta.filter((w) => tb.includes(w)).length;
  return shared === Math.min(ta.length, tb.length) || shared / ta.length >= 0.6;
}

// The job's skills, each marked whether the profile has it. Matched first.
export function skillMatch(required: string[], has: string[], max = 8): Array<{ name: string; ok: boolean }> {
  const mine = has.map(normSkill).filter(Boolean);
  const seen = new Set<string>();
  const out: Array<{ name: string; ok: boolean }> = [];
  for (const name of required) {
    const n = normSkill(name);
    if (!n || n.length > 40 || seen.has(n)) continue;
    seen.add(n);
    const ok = mine.some((m) => sameSkill(n, m));
    out.push({ name: name.trim(), ok });
  }
  return [...out.filter((s) => s.ok), ...out.filter((s) => !s.ok)].slice(0, max);
}

const SKILL_LOOK: Record<string, [string, string]> = {
  java: ['Jv', '#e76f00'], 'spring boot': ['Sb', '#5fa83a'], spring: ['Sp', '#5fa83a'], react: ['Re', '#0e9fc4'], aws: ['Aw', '#e08a00'],
  microservices: ['Ms', '#64748b'], kafka: ['Kf', '#475569'], angular: ['Ng', '#dd0031'], docker: ['Dk', '#1d91e6'], python: ['Py', '#3776ab'],
  pyspark: ['Ps', '#e25a1c'], spark: ['Sk', '#e25a1c'], snowflake: ['Sn', '#1a9fd0'], dbt: ['Db', '#ff694b'], airflow: ['Af', '#017cee'],
  databricks: ['Dx', '#ff3621'], azure: ['Az', '#0078d4'], gcp: ['Gc', '#4285f4'], terraform: ['Tf', '#7b42bc'], kubernetes: ['K8', '#326ce5'],
  jenkins: ['Jk', '#d24939'], go: ['Go', '#00a0c8'], sql: ['Sq', '#0f766e'], 'sql server': ['Ss', '#a91d22'], postgresql: ['Pg', '#336791'],
  mongodb: ['Mg', '#13aa52'], javascript: ['Js', '#c9a400'], typescript: ['Ts', '#3178c6'], node: ['Nd', '#3c873a'], '.net': ['Nt', '#512bd4'],
  'c#': ['C#', '#68217a'], salesforce: ['Sf', '#00a1e0'], servicenow: ['Sv', '#62d84e'], sap: ['Sa', '#0a6ed1'], tableau: ['Tb', '#e97627'],
  powerbi: ['Pb', '#c9a400'], jira: ['Ji', '#0052cc'], agile: ['Ag', '#d97706'], selenium: ['Se', '#43b02a'], linux: ['Lx', '#333333'],
  'machine learning': ['Ml', '#9333ea'], excel: ['Ex', '#1d6f42'], hadoop: ['Hd', '#66ccff'], oracle: ['Or', '#c74634'], kotlin: ['Kt', '#7f52ff'],
  swift: ['Sw', '#f05138'], ios: ['iO', '#555555'], android: ['An', '#3ddc84'], cicd: ['Ci', '#2563eb'], git: ['Gt', '#f05032'],
};
const PALETTE = ['#4f46e5', '#0891b2', '#ea580c', '#0284c7', '#7c3aed', '#0d9488', '#16a34a', '#b91c1c', '#1d4ed8', '#15803d', '#57534e', '#c026d3', '#0f766e', '#9333ea'];

export function hashColor(text: string): string {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// A two-letter symbol and a colour, like a periodic table tile.
export function skillLook(name: string): { symbol: string; color: string } {
  const n = normSkill(name);
  const known = SKILL_LOOK[n];
  if (known) return { symbol: known[0], color: known[1] };
  const words = name.replace(/[^A-Za-z0-9#+ ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const symbol = words.length >= 2 ? `${words[0][0].toUpperCase()}${words[1][0].toLowerCase()}` : `${(words[0] ?? '?')[0].toUpperCase()}${(words[0] ?? '').slice(1, 2).toLowerCase()}`;
  return { symbol, color: hashColor(n) };
}

// ---------- visa ----------

export const VISA_ORDER = ['USC', 'GC', 'GC EAD', 'H1B', 'H4 EAD', 'L2 EAD', 'OPT', 'CPT', 'TN'];

export function normVisa(raw: string): string | null {
  const s = raw.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (/\b(usc|us citizen|citizen|citizenship)\b/.test(s)) return 'USC';
  if (/\bgc ead\b/.test(s)) return 'GC EAD';
  if (/\b(gc|green card|permanent resident)\b/.test(s)) return 'GC';
  if (/\bh ?1 ?b?\b|\bh1b\b/.test(s)) return 'H1B';
  if (/\bh ?4\b/.test(s)) return 'H4 EAD';
  if (/\bl ?2\b/.test(s)) return 'L2 EAD';
  if (/\bopt\b|stem/.test(s)) return 'OPT';
  if (/\bcpt\b/.test(s)) return 'CPT';
  if (/\btn\b/.test(s)) return 'TN';
  return null;
}

export function visaFit(jobVisas: string[], profileVisa: string | null) {
  const accepted = [...new Set(jobVisas.map(normVisa).filter((v): v is string => Boolean(v)))];
  const mine = profileVisa ? normVisa(profileVisa) : null;
  const ok = accepted.length === 0 || !mine ? null : accepted.includes(mine);
  return { accepted, mine, ok };
}

// ---------- location ----------

const STATE_NAMES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT',
  delaware: 'DE', 'district of columbia': 'DC', florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT',
  nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA',
  'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT',
  vermont: 'VT', virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

// US states as a tile grid: [row, column].
export const US_TILES: Record<string, [number, number]> = {
  AK: [0, 0], ME: [0, 11], WI: [1, 6], VT: [1, 10], NH: [1, 11],
  WA: [2, 1], ID: [2, 2], MT: [2, 3], ND: [2, 4], MN: [2, 5], IL: [2, 6], MI: [2, 7], NY: [2, 9], MA: [2, 10],
  OR: [3, 1], NV: [3, 2], WY: [3, 3], SD: [3, 4], IA: [3, 5], IN: [3, 6], OH: [3, 7], PA: [3, 8], NJ: [3, 9], CT: [3, 10], RI: [3, 11],
  CA: [4, 1], UT: [4, 2], CO: [4, 3], NE: [4, 4], MO: [4, 5], KY: [4, 6], WV: [4, 7], VA: [4, 8], MD: [4, 9], DE: [4, 10],
  AZ: [5, 2], NM: [5, 3], KS: [5, 4], AR: [5, 5], TN: [5, 6], NC: [5, 7], SC: [5, 8], DC: [5, 9],
  OK: [6, 4], LA: [6, 5], MS: [6, 6], AL: [6, 7], GA: [6, 8], HI: [7, 0], TX: [7, 4], FL: [7, 9],
};

export function placeOf(raw: string | null | undefined): { city: string | null; state: string | null; remote: boolean } {
  const s = (raw ?? '').trim();
  const remote = /\bremote\b/i.test(s);
  let state: string | null = null;
  let city: string | null = null;
  const parts = s.split(/[,|/]/).map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0 && !state; i--) {
    const tok = parts[i].replace(/\(.*?\)|\d{5}(-\d{4})?/g, '').trim();
    const code = tok.toUpperCase();
    if (US_TILES[code]) state = code;
    else if (STATE_NAMES[tok.toLowerCase()]) state = STATE_NAMES[tok.toLowerCase()];
    else {
      const last = tok.split(/\s+/).pop() ?? '';
      if (last.length === 2 && last === last.toUpperCase() && US_TILES[last]) { state = last; city = tok.slice(0, -2).trim() || null; }
    }
    if (state && !city && i > 0) city = parts[i - 1];
  }
  if (!city && parts[0] && !US_TILES[parts[0].toUpperCase()] && !/remote/i.test(parts[0])) city = parts[0];
  return { city: city && !/remote|usa|united states/i.test(city) ? city : null, state, remote };
}

export type LocationFit = { kind: 'remote' | 'city' | 'state' | 'other' | 'unknown'; jobState: string | null; profileState: string | null; label: string };

export function locationFit(jobLocation: string | null, profileLocations: string[]): LocationFit {
  const job = placeOf(jobLocation);
  const places = profileLocations.map(placeOf);
  const profile = places.find((p) => p.state) ?? places[0] ?? { city: null, state: null, remote: false };
  if (job.remote) return { kind: 'remote', jobState: job.state, profileState: profile.state, label: 'Remote' };
  if (!job.state) return { kind: 'unknown', jobState: null, profileState: profile.state, label: jobLocation?.trim() || 'Location not listed' };
  const sameCity = places.some((p) => p.state === job.state && p.city && job.city && p.city.toLowerCase() === job.city.toLowerCase());
  if (sameCity) return { kind: 'city', jobState: job.state, profileState: job.state, label: 'Same city' };
  if (places.some((p) => p.state === job.state)) return { kind: 'state', jobState: job.state, profileState: job.state, label: `Same state: ${job.state}` };
  if (places.some((p) => p.remote) || profileLocations.some((l) => /relocat|anywhere|open/i.test(l))) {
    return { kind: 'state', jobState: job.state, profileState: profile.state, label: `${job.state}, open to move` };
  }
  return { kind: 'other', jobState: job.state, profileState: profile.state, label: profile.state ? `${profile.state} → ${job.state}` : job.state };
}

// ---------- rate ----------

const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : null;
};

export function rateFit(jobMin: unknown, jobMax: unknown, mineMin: unknown, mineMax: unknown) {
  const job = num(jobMax) ?? num(jobMin);
  const mine = num(mineMin) ?? num(mineMax);
  const kind: 'good' | 'warn' | 'na' = job == null ? 'na' : mine == null || job >= mine - 5 ? 'good' : 'warn';
  return { job, mine, kind };
}

export function agoLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
