// Shared animation engine for the three marketing pages (/, /vendors,
// /bench-sales). Ported from the approved standalone demos. Everything a page
// starts (timers, intervals, animation frames, observers, listeners) goes
// through a Scope, so leaving the page in-app stops all of it at once.

import type { MarketStats, SnapCon, SnapJob, StoryData } from '../../lib/marketSnapshot';

export type { MarketStats, SnapCon, SnapJob, StoryData };

/* ---------- lifetime ---------- */

export class Scope {
  alive = true;
  private timers = new Set<number>();
  private intervals = new Set<number>();
  private frames = new Set<number>();
  private observers: IntersectionObserver[] = [];
  private cleanups: Array<() => void> = [];

  timeout(fn: () => void, ms = 0): number {
    if (!this.alive) return 0;
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (this.alive) fn();
    }, ms);
    this.timers.add(id);
    return id;
  }

  clearTimeout(id: number) {
    if (!id) return;
    window.clearTimeout(id);
    this.timers.delete(id);
  }

  interval(fn: () => void, ms: number): number {
    if (!this.alive) return 0;
    const id = window.setInterval(() => {
      if (this.alive) fn();
    }, ms);
    this.intervals.add(id);
    return id;
  }

  clearInterval(id: number) {
    if (!id) return;
    window.clearInterval(id);
    this.intervals.delete(id);
  }

  raf(fn: (now: number) => void): number {
    if (!this.alive) return 0;
    const id = requestAnimationFrame((now) => {
      this.frames.delete(id);
      if (this.alive) fn(now);
    });
    this.frames.add(id);
    return id;
  }

  on(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions | boolean): () => void {
    target.addEventListener(type, fn, opts);
    let done = false;
    const off = () => {
      if (done) return;
      done = true;
      target.removeEventListener(type, fn, opts);
    };
    this.cleanups.push(off);
    return off;
  }

  observe(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit): IntersectionObserver {
    const io = new IntersectionObserver((entries, obs) => {
      if (this.alive) cb(entries, obs);
    }, opts);
    this.observers.push(io);
    return io;
  }

  add(fn: () => void) {
    this.cleanups.push(fn);
  }

  dispose() {
    if (!this.alive) return;
    this.alive = false;
    this.timers.forEach((id) => window.clearTimeout(id));
    this.intervals.forEach((id) => window.clearInterval(id));
    this.frames.forEach((id) => cancelAnimationFrame(id));
    this.observers.forEach((io) => io.disconnect());
    this.timers.clear();
    this.intervals.clear();
    this.frames.clear();
    this.observers = [];
    const c = this.cleanups;
    this.cleanups = [];
    c.reverse().forEach((fn) => {
      try { fn(); } catch { /* best effort */ }
    });
  }
}

export interface PageEngine {
  /** New stats / date arrived (live data): update the numbers in place. */
  update(data: StoryData): void;
  dispose(): void;
}

export interface EngineOptions {
  /** The app's SiteFooter wrapper, observed so the phone bar hides near it. */
  footer: HTMLElement | null;
  /** In-app navigation for links the engine writes as HTML. */
  navigate: (to: string) => void;
}

/* ---------- small helpers ---------- */

export const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const clamp = (v: number, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const map = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const esc = (s: unknown) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
export const fmt = (v: number) => Math.round(v).toLocaleString('en-US');

export function rng(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Q = <T extends Element = HTMLElement>(s: string, r?: ParentNode) => T;
export type QQ = <T extends Element = HTMLElement>(s: string, r?: ParentNode) => T[];

export function queries(root: HTMLElement): { $: Q; $$: QQ } {
  const $ = (<T extends Element = HTMLElement>(s: string, r: ParentNode = root) => r.querySelector(s) as T) as Q;
  const $$ = (<T extends Element = HTMLElement>(s: string, r: ParentNode = root) =>
    Array.from(r.querySelectorAll(s)) as T[]) as QQ;
  return { $, $$ };
}

/** First element child of a parsed HTML string. */
export function htmlEl(html: string): HTMLElement {
  const t = document.createElement('div');
  t.innerHTML = html.trim();
  return t.firstElementChild as HTMLElement;
}

/** Forces a style flush so a removed-then-added class restarts its animation. */
export function reflow(el: HTMLElement) {
  return el.offsetWidth;
}

/* ---------- data formatting (real snapshot only) ---------- */

const KEEP = new Set(['AWS', 'SAP', 'SD', 'DBA', 'AI/ML', '.NET', 'FICO', 'PRPC', 'HANA', 'S/4', 'DEVOPS', 'II']);
/** Title-cases ALL-CAPS hotlist roles, keeping acronyms. */
export function tc(s: string) {
  if (s !== s.toUpperCase()) return s;
  return s
    .toLowerCase()
    .split(' ')
    .map((w) => {
      const U = w.toUpperCase();
      if (U === 'DEVOPS') return 'DevOps';
      if (KEEP.has(U)) return U;
      if (U === 'SR.') return 'Sr.';
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}
export const okLoc = (l: string | null | undefined): l is string => !!l && !/^(yes|no|usa)$/i.test(l.trim());
export const okWork = (w: string | null | undefined): w is string => !!w && !/unknown/i.test(w);
export const workLabel = (w: string) => w.replace('Remote/Hybrid/On', 'Remote/Hybrid');

export function newestAt(data: StoryData) {
  const all = [...data.jobs, ...data.hotlist].map((x) => Date.parse(x.at)).filter((n) => !Number.isNaN(n));
  return all.length ? Math.max(...all) : Date.now();
}

export function makeAgo(now: number) {
  return function ago(at: string) {
    const m = Math.round((now - Date.parse(at)) / 60000);
    if (!(m >= 1)) return 'Posted just now';
    if (m < 60) return 'Posted ' + m + (m === 1 ? ' min' : ' mins') + ' ago';
    const h = Math.floor(m / 60);
    if (h < 48) return 'Posted ' + h + (h === 1 ? ' hr' : ' hrs') + ' ago';
    const d = Math.floor(h / 24);
    return 'Posted ' + d + ' days ago';
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-07" -> "7 Oct 2026" */
export function fmtDate(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return iso;
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
}

export const ICONS: Record<string, string> = {
  cap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/></svg>',
  bld: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>',
  shd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/></svg>',
  lap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>',
};

export const chip = (ic: string, t: unknown) => (t ? `<span class="chip">${ICONS[ic]}${esc(t)}</span>` : '');

export function cardMakers(ago: (at: string) => string) {
  function jobCard(j: SnapJob, isNew: boolean, tag?: string) {
    return `<div class="tc${isNew ? ' new' : ''}"><div class="tc-h"><span class="tc-t">${esc(j.t)}</span>${tag || ''}</div>
  <div class="chips">${j.exp && j.exp < 40 ? chip('cap', j.exp) : ''}${chip('bld', j.type)}${okLoc(j.loc) ? chip('pin', j.loc) : ''}</div>
  <div class="tc-f"><span>${ago(j.at)}</span><span class="kd j">Requirement</span></div></div>`;
  }
  function conCard(c: SnapCon, isNew: boolean, tag?: string) {
    return `<div class="tc${isNew ? ' new' : ''}"><div class="tc-h"><span class="tc-t">${esc(tc(c.t))}</span>${tag || ''}</div>
  <div class="chips">${c.exp ? chip('cap', c.exp) : ''}${okWork(c.work) ? chip('lap', workLabel(c.work)) : ''}${chip('shd', c.visa)}${okLoc(c.loc) ? chip('pin', c.loc) : ''}</div>
  <div class="tc-f"><span>${ago(c.at)}</span><span class="kd c">Consultant</span></div></div>`;
  }
  return { jobCard, conCard };
}

export const jobSub = (j: SnapJob) =>
  [okLoc(j.loc) ? j.loc : '', j.type, j.exp && j.exp < 40 ? j.exp + ' yrs' : ''].filter(Boolean).join(' · ');

/* ---------- stats in the page markup ---------- */

/**
 * Writes the stats into every [data-stat] element and the date into every
 * [data-asof] element. Count-up targets ([data-n]) are updated too; a count
 * that is still running reads its target every frame, so it lands on the new
 * number.
 */
export function applyStats(root: HTMLElement, data: StoryData) {
  const st = data.stats as unknown as Record<string, number>;
  root.querySelectorAll<HTMLElement>('[data-stat]').forEach((el) => {
    const v = st[el.dataset.stat as string];
    if (typeof v !== 'number') return;
    if (el.dataset.n !== undefined) {
      el.dataset.n = String(v);
      if (el.dataset.counting !== '1') setCountText(el, v);
    } else {
      el.textContent = fmt(v);
    }
  });
  root.querySelectorAll<HTMLElement>('[data-asof]').forEach((el) => {
    el.textContent = fmtDate(data.asOf);
  });
}

function setCountText(el: HTMLElement, v: number) {
  const sm = el.querySelector('small');
  if (sm) el.innerHTML = fmt(v) + sm.outerHTML;
  else el.textContent = fmt(v);
}

/** Counts an element up to its data-n (read every frame). */
export function countUp(S: Scope, el: HTMLElement, dur: number, power: number) {
  const t0 = performance.now();
  el.dataset.counting = '1';
  const f = (now: number) => {
    const n = +(el.dataset.n || 0);
    const k = clamp((now - t0) / dur);
    setCountText(el, n * (1 - Math.pow(1 - k, power)));
    if (k < 1) S.raf(f);
    else el.dataset.counting = '';
  };
  S.raf(f);
  S.add(() => {
    if (el.dataset.counting === '1') {
      el.dataset.counting = '';
      setCountText(el, +(el.dataset.n || 0));
    }
  });
}

/* ---------- hero torrent (canvas) ---------- */

export interface Word { t: string; m: string; v?: boolean }
interface Layer { fs: number; a: number; v: number; w: number }
interface Drop { l: number; x: number; y: number | undefined; v: boolean; t: string; m: string }

export interface TorrentOptions {
  layers: Layer[];
  /** 'split': vendor words on the left of the split line, bench words on the right (homepage). */
  mode: 'split' | 'single';
  words: { v: Word[]; b: Word[] } | Word[];
  stroke: (v: boolean) => string;
  meta: (v: boolean) => string;
  ready: () => boolean;
}

export class Torrent {
  private cx: CanvasRenderingContext2D | null;
  private W = 0;
  private H = 0;
  private drops: Drop[] = [];
  private R = rng(42);
  private loopOn = false;
  private lastF = 0;
  private vis = true;
  split = 0.5;

  constructor(private S: Scope, private cv: HTMLCanvasElement, private hero: HTMLElement, private o: TorrentOptions, private RM: boolean) {
    this.cx = cv.getContext('2d');
    S.observe((es) => {
      this.vis = es[0].isIntersecting;
      this.loop();
    }).observe(hero);
    S.on(document, 'visibilitychange', () => this.loop());
    let hz = 0;
    S.on(window, 'resize', () => {
      S.clearTimeout(hz);
      hz = S.timeout(() => {
        if (Math.abs(hero.clientWidth - this.W) > 40 || (o.mode === 'split' && Math.abs(hero.clientHeight - this.H) > 80)) {
          this.size();
          this.draw(0);
        }
      }, 200);
    });
    S.add(() => {
      this.loopOn = false;
    });
  }

  setWords(words: TorrentOptions['words']) {
    this.o.words = words;
  }

  private trunc(s: string, max: number) {
    const cx = this.cx as CanvasRenderingContext2D;
    if (cx.measureText(s).width <= max) return s;
    while (s.length > 3 && cx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }

  private spawn(d: Drop, top: boolean) {
    const cx = this.cx as CanvasRenderingContext2D;
    const L = this.o.layers[d.l];
    const R = this.R;
    let it: Word;
    if (this.o.mode === 'split') {
      d.x = R() * (this.W + L.w) - L.w * 0.6;
      if (top) d.y = -80 - R() * this.H * 0.3;
      else if (d.y === undefined) d.y = R() * this.H;
      d.v = d.x + L.w / 2 < this.W * this.split;
      const w = this.o.words as { v: Word[]; b: Word[] };
      const list = d.v ? w.v : w.b;
      it = list[Math.floor(R() * list.length)] || { t: '', m: '' };
    } else {
      const list = this.o.words as Word[];
      it = list[Math.floor(R() * list.length)] || { t: '', m: '' };
      d.x = R() * (this.W + L.w) - L.w * 0.6;
      d.y = top ? -80 - R() * this.H * 0.3 : R() * this.H;
      d.v = !!it.v;
    }
    cx.font = `600 ${L.fs}px Inter, system-ui, sans-serif`;
    d.t = this.trunc(it.t, L.w - 24);
    cx.font = `500 ${L.fs - 2}px Inter, system-ui, sans-serif`;
    d.m = this.trunc(it.m, L.w - 24);
  }

  size() {
    if (!this.cx) return;
    this.W = this.cv.width = this.hero.clientWidth;
    this.H = this.cv.height = this.hero.clientHeight;
    const n = Math.round((this.W * this.H) / 15000);
    this.drops = [];
    for (let i = 0; i < n; i++) {
      const d: Drop = { l: i % 3, x: 0, y: undefined, v: false, t: '', m: '' };
      this.spawn(d, false);
      this.drops.push(d);
    }
  }

  respawnAll() {
    this.drops.forEach((d) => this.spawn(d, false));
    this.draw(0);
  }

  draw(dt: number) {
    const cx = this.cx;
    if (!cx) return;
    cx.clearRect(0, 0, this.W, this.H);
    for (const d of this.drops) {
      const L = this.o.layers[d.l];
      d.y = (d.y ?? 0) + L.v * dt;
      if (d.y > this.H + 20) this.spawn(d, true);
      const y = d.y ?? 0;
      const h = L.fs * 3.3;
      cx.globalAlpha = L.a;
      cx.fillStyle = '#ffffff';
      cx.strokeStyle = this.o.stroke(d.v);
      cx.lineWidth = 1;
      cx.beginPath();
      if (typeof cx.roundRect === 'function') cx.roundRect(d.x, y, L.w, h, 8);
      else cx.rect(d.x, y, L.w, h);
      cx.fill();
      cx.stroke();
      cx.fillStyle = '#334155';
      cx.font = `600 ${L.fs}px Inter, system-ui, sans-serif`;
      cx.fillText(d.t, d.x + 12, y + L.fs * 1.35);
      cx.fillStyle = this.o.meta(d.v);
      cx.font = `500 ${L.fs - 2}px Inter, system-ui, sans-serif`;
      cx.fillText(d.m, d.x + 12, y + L.fs * 2.55);
    }
    cx.globalAlpha = 1;
  }

  /** Starts or stops the 30fps loop: only on screen, in a visible tab, after the intro. */
  loop() {
    const want = !this.RM && this.vis && !document.hidden && this.o.ready();
    if (want && !this.loopOn) {
      this.loopOn = true;
      this.lastF = performance.now();
      const frame = (now: number) => {
        if (!this.loopOn) return;
        this.S.raf(frame);
        if (now - this.lastF < 33) return;
        const dt = Math.min(0.1, (now - this.lastF) / 1000);
        this.lastF = now;
        this.draw(dt);
      };
      this.S.raf(frame);
    } else if (!want) this.loopOn = false;
  }

  get running() {
    return this.loopOn;
  }
}

/* ---------- page-level wiring shared by all three ---------- */

/**
 * Root click handling: smooth in-page scrolling for "#id" links, and in-app
 * navigation for the "/path" links the engine writes as plain HTML (React
 * <Link>s handle their own clicks and are skipped).
 */
export function wireLinks(S: Scope, root: HTMLElement, navigate: (to: string) => void, RM: boolean) {
  S.on(root, 'click', (ev) => {
    const e = ev as MouseEvent;
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = (e.target as Element | null)?.closest?.('a');
    if (!a || !root.contains(a)) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#') && href.length > 1) {
      const t = root.querySelector(href);
      if (!t) return;
      e.preventDefault();
      t.scrollIntoView({ behavior: RM ? 'auto' : 'smooth', block: 'start' });
      return;
    }
    if (a.hasAttribute('data-spa') && href.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    }
  });
}
