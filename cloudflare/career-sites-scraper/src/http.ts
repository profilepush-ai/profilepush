// Polite fetching: robots.txt (RFC 9309), a per-host gap between requests and
// an honest user agent.
export const UA = "Mozilla/5.0 (compatible; ProfilePushJobsBot/1.0; +https://profilepush.ai)";
const MIN_GAP_MS = 400;

type Rules = { allow: string[]; disallow: string[] } | "allow-all" | "disallow-all";
const robotsCache = new Map<string, Promise<Rules>>();
const lastRequest = new Map<string, number>();

function parseRobots(text: string): Rules {
  // Use the group for our token if present, otherwise the "*" group.
  const groups: Array<{ agents: string[]; allow: string[]; disallow: string[] }> = [];
  let current: { agents: string[]; allow: string[]; disallow: string[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" && value) current.allow.push(value);
    if (key === "disallow" && value) current.disallow.push(value);
  }
  const ours = groups.find((g) => g.agents.some((a) => a !== "*" && "profilepushjobsbot".includes(a)));
  const star = groups.find((g) => g.agents.includes("*"));
  const g = ours ?? star;
  return g ? { allow: g.allow, disallow: g.disallow } : "allow-all";
}

function patternMatch(pattern: string, path: string): number {
  // Returns the matched pattern length (longest match wins), or -1.
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = new RegExp("^" + body.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + (anchored ? "$" : ""));
  return re.test(path) ? pattern.length : -1;
}

async function rulesFor(origin: string): Promise<Rules> {
  let p = robotsCache.get(origin);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": UA } });
        if (res.status >= 400 && res.status < 500) return "allow-all";
        if (!res.ok) return "disallow-all";
        return parseRobots(await res.text());
      } catch {
        return "disallow-all";
      }
    })();
    robotsCache.set(origin, p);
  }
  return p;
}

export async function allowed(url: string): Promise<boolean> {
  const u = new URL(url);
  const rules = await rulesFor(u.origin);
  if (rules === "allow-all") return true;
  if (rules === "disallow-all") return false;
  const path = u.pathname + u.search;
  const best = (list: string[]) => Math.max(-1, ...list.map((p) => patternMatch(p, path)));
  const a = best(rules.allow);
  const d = best(rules.disallow);
  return d < 0 || a >= d;
}

export class Budget {
  constructor(public remaining: number) {}
  take(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining -= 1;
    return true;
  }
}

export async function politeFetch(url: string, budget: Budget, init: RequestInit = {}): Promise<Response> {
  if (!(await allowed(url))) throw new Error(`robots.txt disallows ${url}`);
  if (!budget.take()) throw new Error("subrequest budget exhausted");
  const host = new URL(url).host;
  const wait = (lastRequest.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest.set(host, Date.now());
  const res = await fetch(url, { ...init, headers: { "User-Agent": UA, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

export function stripHtml(input: string | null | undefined): string {
  let s = decodeEntities(input ?? "");
  s = s.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>|<\/h\d>/gi, "\n");
  s = decodeEntities(s.replace(/<[^>]+>/g, " "));
  return s.replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&ndash;/g, "–").replace(/&mdash;/g, "—")
    .replace(/&rsquo;|&lsquo;/g, "'").replace(/&rdquo;|&ldquo;/g, '"').replace(/&bull;/g, "•");
}
