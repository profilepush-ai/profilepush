// The live market numbers and rows behind the marketing pages.
//
// The pages render at once from the snapshot bundled with the build
// (src/data/market-snapshot.json) and then ask Supabase for the live one
// (public.public_market_snapshot(), a public, anonymised RPC). The live answer
// is cached in sessionStorage for ten minutes, so moving between /, /vendors
// and /bench-sales does not refetch it. If the RPC fails or is not deployed
// yet, the bundled snapshot stays on screen; nothing breaks.
//
// The RPC returns roles, skills, experience, visa, work type, city and time
// only. Never names, emails, phone numbers, companies or ids.

import bundledRaw from '../data/market-snapshot.json?raw';
import { supabase } from './supabase';

export interface SnapJob {
  t: string;
  loc: string;
  type: string;
  skills: string[];
  exp: number | null;
  at: string;
}

export interface SnapCon {
  t: string;
  skills: string[];
  exp: number | null;
  visa: string;
  work: string;
  loc: string;
  at: string;
}

export interface MarketStats {
  jobs24h: number;
  jobs7d: number;
  jobs30d: number;
  jobsAll: number;
  hot24h: number;
  hot7d: number;
  hot30d: number;
  hotAll: number;
}

export interface MarketSnapshot {
  jobs: SnapJob[];
  hotlist: SnapCon[];
  stats: MarketStats;
  asOf: string;
  live: boolean;
}

/** What a page animates: see composeStoryData. */
export type StoryData = MarketSnapshot;

const CACHE_KEY = 'pp-market-snapshot-v1';
const TTL_MS = 10 * 60 * 1000;
const STAT_KEYS: Array<keyof MarketStats> = ['jobs24h', 'jobs7d', 'jobs30d', 'jobsAll', 'hot24h', 'hot7d', 'hot30d', 'hotAll'];

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const isoAt = (v: unknown) => {
  const s = str(v);
  return s && !Number.isNaN(Date.parse(s)) ? s : '';
};

function normJob(x: Record<string, unknown>): SnapJob | null {
  const t = str(x.t ?? x.title).trim();
  const at = isoAt(x.at);
  if (!t || !at) return null;
  return { t, loc: str(x.loc), type: str(x.type), skills: strs(x.skills).slice(0, 4), exp: num(x.exp), at };
}

function normCon(x: Record<string, unknown>): SnapCon | null {
  const t = str(x.t ?? x.title).trim();
  const at = isoAt(x.at);
  if (!t || !at) return null;
  return { t, skills: strs(x.skills).slice(0, 4), exp: num(x.exp), visa: str(x.visa), work: str(x.work), loc: str(x.loc), at };
}

function normalize(raw: unknown, live: boolean): MarketSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const s = (r.stats ?? {}) as Record<string, unknown>;
  const stats = {} as MarketStats;
  for (const k of STAT_KEYS) {
    const v = Number(s[k]);
    if (!Number.isFinite(v) || v < 0) return null;
    stats[k] = v;
  }
  const rows = (v: unknown) => (Array.isArray(v) ? (v as Array<Record<string, unknown>>) : []);
  const jobs = rows(r.jobs).map(normJob).filter((x): x is SnapJob => !!x);
  const hotlist = rows(r.hotlist).map(normCon).filter((x): x is SnapCon => !!x);
  const asOf = /^\d{4}-\d{2}-\d{2}/.test(str(r.asOf)) ? str(r.asOf).slice(0, 10) : '';
  if (!asOf) return null;
  return { jobs, hotlist, stats, asOf, live };
}

export const BUNDLED_SNAPSHOT: MarketSnapshot = normalize(JSON.parse(bundledRaw), false) as MarketSnapshot;

/** A fresh (under ten minutes old) live snapshot from this tab's cache, if any. */
export function getCachedSnapshot(): MarketSnapshot | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { t, d } = JSON.parse(raw) as { t: number; d: unknown };
    if (!t || Date.now() - t > TTL_MS) return null;
    return normalize(d, true);
  } catch {
    return null;
  }
}

let inflight: Promise<MarketSnapshot | null> | null = null;
// After a failure (say, the RPC is not deployed yet) the pages stay on the
// bundled snapshot; don't ask again on every in-app navigation.
let failedAt = 0;

/** The live snapshot (cached for ten minutes), or null if the RPC is unavailable. */
export function fetchMarketSnapshot(): Promise<MarketSnapshot | null> {
  const cached = getCachedSnapshot();
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  if (failedAt && Date.now() - failedAt < TTL_MS) return Promise.resolve(null);
  inflight = (async () => {
    try {
      const { data, error } = await supabase.rpc('public_market_snapshot' as never);
      const snap = !error && data ? normalize(data, true) : null;
      if (!snap) {
        failedAt = Date.now();
        return null;
      }
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: data }));
      } catch {
        /* storage full or blocked: fine, just no cache */
      }
      return snap;
    } catch {
      failedAt = Date.now();
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** The best snapshot available synchronously: the cached live one, else the bundled one. */
export function initialSnapshot(): MarketSnapshot {
  return getCachedSnapshot() ?? BUNDLED_SNAPSHOT;
}

// The rows each page's story is built on (the columns, their matches, the
// emails, the screening card, the pasted hotlist) were picked by hand from the
// bundled snapshot so that every match is a real fit. Those positions keep
// their bundled rows; every other position (the "noise" in the flood and the
// hero torrent) is filled with live rows.
const STORY_JOBS = new Set([0, 4, 6, 13, 14, 18, 19, 20, 24, 27, 30, 32, 36, 38]);
const STORY_HOTLIST = new Set([0, 7, 9, 10, 11, 15, 17, 19, 20, 21, 23, 24, 35, 37]);

function shiftAt(at: string, by: number) {
  return new Date(Date.parse(at) + by).toISOString();
}

function newest(xs: Array<{ at: string }>) {
  let m = 0;
  for (const x of xs) {
    const t = Date.parse(x.at);
    if (t > m) m = t;
  }
  return m;
}

/**
 * The data a page animates: live stats and date, the hand-picked story rows
 * from the bundled snapshot, and live rows everywhere else. The story rows'
 * times are moved forward so "Posted 4 mins ago" stays true relative to the
 * newest live row.
 */
export function composeStoryData(snap: MarketSnapshot): StoryData {
  const base = BUNDLED_SNAPSHOT;
  if (!snap.live) return base;
  const liveNow = newest([...snap.jobs, ...snap.hotlist]);
  const baseNow = newest([...base.jobs, ...base.hotlist]);
  const by = liveNow && baseNow ? Math.max(0, liveNow - baseNow) : 0;
  const storyTitlesJ = new Set([...STORY_JOBS].map((i) => base.jobs[i]?.t.toLowerCase()));
  const storyTitlesH = new Set([...STORY_HOTLIST].map((i) => base.hotlist[i]?.t.toLowerCase()));
  const liveJ = snap.jobs.filter((j) => !storyTitlesJ.has(j.t.toLowerCase()));
  const liveH = snap.hotlist.filter((c) => !storyTitlesH.has(c.t.toLowerCase()));
  let a = 0;
  let b = 0;
  const jobs = base.jobs.map((j, i) => {
    if (STORY_JOBS.has(i) || a >= liveJ.length) return { ...j, at: shiftAt(j.at, by) };
    return liveJ[a++];
  });
  const hotlist = base.hotlist.map((c, i) => {
    if (STORY_HOTLIST.has(i) || b >= liveH.length) return { ...c, at: shiftAt(c.at, by) };
    return liveH[b++];
  });
  return { jobs, hotlist, stats: snap.stats, asOf: snap.asOf, live: true };
}
