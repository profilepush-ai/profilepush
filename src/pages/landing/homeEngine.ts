// Homepage engine: hero torrent + Vendor | Both | Bench switch (with
// auto-toggle), the pinned scroll-driven filter on desktop, the phone ticker,
// the self-typing emails, the live Tracker columns, count-ups and the phone
// bar. Ported from website-demos/profilepush-ai/both-sides-v2.

import {
  Scope, Torrent, applyStats, cardMakers, clamp, countUp, ease, esc, fmt, htmlEl, jobSub, lerp, makeAgo,
  map, newestAt, okLoc, queries, reducedMotion, reflow, rng, tc, wireLinks,
} from './engine';
import type { EngineOptions, PageEngine, SnapCon, SnapJob, StoryData } from './engine';

type Side = 'both' | 'vendor' | 'bench';
type Mode = 'vendor' | 'bench';
type Item = SnapJob | SnapCon;

interface ColDef { h: Item; m: number[] }
interface ModeDef {
  flood: Item[];
  card: (x: Item, isNew: boolean, tag?: string) => string;
  k: string;
  cols: ColDef[];
  head: (x: Item) => { t: string; s: string; dot: string; p2: string };
}

interface BoardApi { mode: Mode; total: number; nFit: number; layout(): void; update(p: number): void }

interface FloodCard {
  el: HTMLElement; i: number; m: { ci: number; k: number } | null;
  s0: number; w: number; x0: number; y0: number; r0: number; dir: number; b0: number; o0: number; fall: number; tx: number; ty: number;
}

export function startHome(root: HTMLElement, data: StoryData, opts: EngineOptions): PageEngine {
  const S = new Scope();
  const RM = reducedMotion();
  const { $, $$ } = queries(root);
  let D = data;
  let side: Side = 'both';
  let pick: Mode = 'vendor';
  root.dataset.side = 'both';
  root.dataset.pick = 'vendor';

  const ago = makeAgo(newestAt(D));
  const { jobCard, conCard } = cardMakers(ago);
  const conSub = (c: SnapCon) =>
    [c.skills.slice(0, 3).join(', '), c.exp ? c.exp + ' yrs' : '', c.visa, okLoc(c.loc) ? c.loc : ''].filter(Boolean).join(' · ');

  /* the two sides: real snapshot items, matched by role and skills.
     vendor = has requirements -> flood of hotlist consultants, one column per requirement
     bench  = has consultants  -> flood of requirements, one column per consultant */
  const MODES: Record<Mode, ModeDef> = {
    bench: {
      flood: D.jobs, card: (x, n, t) => jobCard(x as SnapJob, n, t), k: 'kb',
      cols: [{ h: D.hotlist[21], m: [14, 19, 24] }, { h: D.hotlist[0], m: [27, 4, 38] }, { h: D.hotlist[20], m: [6, 30] }],
      head: (c) => ({ t: tc(c.t), s: conSub(c as SnapCon), dot: '', p2: 'Submitted' }),
    },
    vendor: {
      flood: D.hotlist, card: (x, n, t) => conCard(x as SnapCon, n, t), k: 'kv',
      cols: [{ h: D.jobs[14], m: [21, 9, 37] }, { h: D.jobs[4], m: [0, 11, 23] }, { h: D.jobs[0], m: [15, 24, 10] }],
      head: (j) => ({ t: j.t, s: jobSub(j as SnapJob), dot: ' o', p2: 'Requested' }),
    },
  };
  function colHTML(mode: Mode, ci: number, newN: number, inner: string) {
    const M = MODES[mode], c = M.cols[ci], h = M.head(c.h);
    return `<div class="col ${M.k} c${ci}"><div class="col-h"><div class="h"><span class="dot${h.dot}"></span><span>${esc(h.t)}</span></div><p>${esc(h.s)}</p>
  <div class="pills"><span class="pill">New <b data-new>${newN}</b></span><span class="pill mu">${h.p2} <b>0</b></span></div></div>
  <div class="col-b"><div class="slots">${inner}</div></div></div>`;
  }
  const stackMode = (): Mode => (side === 'both' ? pick : side);
  let lastFit = 0;
  function texts(nFit: number) {
    lastFit = nFit;
    const st = D.stats;
    const c0 = {
      both: `${fmt(st.hot24h)} consultants and ${fmt(st.jobs24h)} requirements in 24 hours. Real ones from today, on both sides.`,
      vendor: `${fmt(st.hot24h)} hotlist consultants in 24 hours. Here are 40 real ones from today.`,
      bench: `${fmt(st.jobs24h)} requirements in 24 hours. Here are 40 real ones from the last few minutes.`,
    };
    const c2 = {
      both: 'One tidy column per requirement. One per consultant. Same deal, both ends.',
      vendor: `${nFit} of 40 fit. Pushed into one tidy column per requirement.`,
      bench: `${nFit} of 40 fit. Pushed into one tidy column per consultant.`,
    };
    $$('[data-t=c0]').forEach((e) => (e.textContent = c0[side]));
    $$('[data-t=c2]').forEach((e) => (e.textContent = c2[side]));
    const sm = stackMode();
    $$('[data-t=s0]').forEach(
      (e) => (e.textContent = sm === 'vendor' ? `${fmt(st.hot24h)} consultants in 24h. Only fits get through.` : `${fmt(st.jobs24h)} reqs in 24h. Only fits get through.`),
    );
    $('#tkCap').textContent = sm === 'vendor' ? 'Live hotlist consultants' : 'Live requirements';
    $('#fxStack').classList.toggle('b', sm === 'bench');
  }

  /* ---------- PINNED (desktop): one board per side ---------- */
  const pinEl = $('#fxPin'), boardsEl = $('#boards');
  let boards: BoardApi[] = [];
  const caps = $$('.cap');
  let pinOn = false, lastP = -1;
  function Board(host: HTMLElement, mode: Mode, ncols: number, nflood: number, seed: number): BoardApi {
    const M = MODES[mode], cs = M.cols.slice(0, ncols);
    const matchOf: Record<number, { ci: number; k: number }> = {};
    cs.forEach((c, ci) => c.m.forEach((idx, k) => (matchOf[idx] = { ci, k })));
    let idxs = M.flood.map((_, i) => i);
    if (nflood < idxs.length) {
      const mIdx = idxs.filter((i) => i in matchOf), noise = idxs.filter((i) => !(i in matchOf)), need = nflood - mIdx.length, step = noise.length / need, pk: number[] = [];
      for (let k = 0; k < need; k++) pk.push(noise[Math.floor(k * step)]);
      idxs = mIdx.concat(pk).sort((a, b) => a - b);
    }
    const nFit = cs.reduce((a, c) => a + c.m.length, 0);
    const lab = mode === 'vendor'
      ? '<span class="side-label v"><i></i>Vendor · consultants for your req</span>'
      : '<span class="side-label b"><i></i>Bench sales · reqs for your consultant</span>';
    const cta = mode === 'vendor'
      ? `<div class="bd-cta"><span class="t"><span class="ddc" aria-hidden="true"><i></i><i></i><svg viewBox="0 0 10 16"><use href="#ddchev"/></svg></span>One tap: AI Request to all ${nFit}</span><a class="btn btn-p" href="/signup" data-spa data-path="vendor" tabindex="-1">Match my requirement <svg class="chev" aria-hidden="true"><use href="#chev"/></svg></a></div>`
      : `<div class="bd-cta"><span class="t"><span class="ddc" aria-hidden="true"><i></i><i></i><svg viewBox="0 0 10 16"><use href="#ddchev"/></svg></span>One tap: AI Submit to all ${nFit}</span><a class="btn btn-b" href="/signup" data-spa data-path="bench" tabindex="-1">Match my bench <svg class="chev" aria-hidden="true"><use href="#chev"/></svg></a></div>`;
    host.innerHTML = `<div class="bd-h">${lab}<span class="fx-progress" aria-hidden="true">Fits <b data-fit>0</b> of <b>${idxs.length}</b></span></div>
  <div class="board"><div class="cols" style="grid-template-columns:repeat(${ncols},minmax(0,1fr))">${cs.map((c, ci) => colHTML(mode, ci, 0, c.m.map((_, k) => `<div class="slot" data-c="${ci}" data-k="${k}"></div>`).join(''))).join('')}</div><div class="field"></div>
  ${cta}<div class="sweep"><svg viewBox="0 0 150 600" preserveAspectRatio="none"><defs><linearGradient id="sg-${mode}" x1="0" x2="1"><stop offset="0" stop-color="#2563eb" stop-opacity="0"/><stop offset="1" stop-color="#2563eb" stop-opacity=".35"/></linearGradient></defs><path d="M0 0 L110 300 L0 600 Z" fill="url(#sg-${mode})"/><path d="M40 6 L136 300 L40 594" fill="none" stroke="#2563eb" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div></div>`;
    const board = $('.board', host), sweep = $('.sweep', host), ctaEl = $('.bd-cta', host), ctaA = $<HTMLAnchorElement>('.bd-cta a', host), cols = $$('.col', host), fitEl = $('[data-fit]', host), field = $('.field', host);
    const cards: FloodCard[] = idxs.map((i) => {
      const el = document.createElement('div');
      el.className = 'fc';
      el.innerHTML = M.card(M.flood[i], false);
      field.appendChild(el);
      return { el, i, m: matchOf[i] || null, s0: 0, w: 0, x0: 0, y0: 0, r0: 0, dir: 1, b0: 0, o0: 0, fall: 0, tx: 0, ty: 0 };
    });
    let W = 0, H = 0;
    function layout() {
      const br = board.getBoundingClientRect();
      W = br.width; H = br.height;
      cols.forEach((c) => (c.style.transform = 'none'));
      const slots = $$('.slot', board);
      if (!slots.length) return;
      const cw = slots[0].getBoundingClientRect().width;
      const R = rng(seed);
      for (const c of cards) {
        c.el.style.width = cw + 'px';
        const s0 = c.m ? 0.5 + R() * 0.12 : 0.38 + R() * 0.34;
        c.s0 = s0; c.w = cw;
        c.x0 = R() * (W - cw * s0);
        c.y0 = c.m ? (0.08 + R() * 0.7) * (H - 116 * s0) : (R() * 1.15 - 0.1) * (H - 116 * s0);
        c.r0 = (R() - 0.5) * 12; c.dir = R() < 0.5 ? -1 : 1;
        c.b0 = c.m ? 1.6 : 1 + (0.72 - s0) * 7;
        c.o0 = c.m ? 0.62 : 0.28 + (s0 - 0.38) * 1.3;
        c.fall = 0.6 + R() * 0.5;
        if (c.m) {
          const m = c.m;
          const sl = slots.find((s) => +(s.dataset.c as string) === m.ci && +(s.dataset.k as string) === m.k);
          if (sl) { const r = sl.getBoundingClientRect(); c.tx = r.left - br.left; c.ty = r.top - br.top; }
        }
      }
    }
    function update(p: number) {
      const s = map(p, 0.14, 0.5);
      const sx = -150 + s * (W + 300);
      sweep.style.opacity = s > 0 && s < 1 ? '1' : '0';
      sweep.style.transform = `translateX(${sx.toFixed(1)}px)`;
      const g = ease(map(p, 0.5, 0.8));
      const drift = p * 90;
      let fits = 0;
      for (const c of cards) {
        const cx = c.x0 + (c.w * c.s0) / 2;
        const k = clamp((sx + 120 - cx) / 170);
        let x = c.x0, y = c.y0 + drift * (1 - c.s0), sc = c.s0, rot = c.r0, o = c.o0, b = c.b0;
        if (!c.m) {
          const f = k * k;
          y += f * H * c.fall; x += f * 30 * c.dir; rot += f * 26 * c.dir; o = c.o0 * (1 - k); b = c.b0 + k * 5;
          if (o < 0.01) { c.el.style.visibility = 'hidden'; continue; }
          c.el.style.visibility = '';
        } else {
          b = c.b0 * (1 - k); o = lerp(c.o0, 1, k); sc = lerp(c.s0, c.s0 * 1.12, k);
          if (k > 0.6) fits++;
          c.el.classList.toggle('hit', k > 0.6 && g < 0.98);
          x = lerp(x, c.tx, g); y = lerp(y, c.ty, g); sc = lerp(sc, 1, g); rot = lerp(rot, 0, g);
        }
        c.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
        c.el.style.opacity = o.toFixed(3);
        c.el.style.filter = b > 0.05 ? `blur(${b.toFixed(1)}px)` : 'none';
        c.el.style.zIndex = c.m ? '2' : '1';
      }
      if (fitEl.textContent !== String(fits)) fitEl.textContent = String(fits);
      const cq = map(p, 0.84, 0.94);
      ctaEl.style.opacity = String(cq);
      ctaEl.style.transform = `translateY(${((1 - cq) * 16).toFixed(1)}px)`;
      const con = cq > 0.5;
      if (ctaEl.classList.contains('on') !== con) { ctaEl.classList.toggle('on', con); ctaA.tabIndex = con ? 0 : -1; }
      const ch = map(p, 0.46, 0.62);
      cols.forEach((col, i) => {
        col.style.opacity = String(ch);
        col.style.transform = `translateY(${(1 - ch) * 24}px)`;
        const n = String(Math.round(map(p, 0.78 + i * 0.02, 0.86 + i * 0.02) * cs[i].m.length));
        const e = $('[data-new]', col);
        if (e.textContent !== n) e.textContent = n;
      });
    }
    return { mode, total: idxs.length, nFit, layout, update };
  }
  function buildPin() {
    const both = side === 'both';
    boardsEl.classList.toggle('two', both);
    const wrapW = boardsEl.clientWidth || 1100;
    let defs: Array<[Mode, number, number]>;
    if (both) {
      const n = (wrapW - 40) / 2 >= 520 ? 2 : 1;
      defs = [['vendor', n, n === 2 ? 22 : 16], ['bench', n, n === 2 ? 22 : 16]];
    } else defs = [[side as Mode, wrapW >= 1000 ? 3 : 2, 40]];
    boardsEl.innerHTML = defs.map((d) => `<div class="bd ${d[0] === 'vendor' ? 'v' : 'b'}"></div>`).join('');
    const hosts = $$('.bd', boardsEl);
    boards = defs.map((d, i) => Board(hosts[i], d[0], d[1], d[2], d[0] === 'vendor' ? 10 : 7));
    texts(boards[0].nFit);
    layoutPin();
  }
  function layoutPin() {
    boards.forEach((b) => b.layout());
    lastP = -1;
    updatePin(true);
  }
  function updatePin(force?: boolean) {
    const r = pinEl.getBoundingClientRect();
    const total = r.height - innerHeight;
    const p = clamp(-r.top / total);
    if (!force && Math.abs(p - lastP) < 0.0005) return;
    lastP = p;
    const ci = p < 0.17 ? 0 : p < 0.5 ? 1 : 2;
    caps.forEach((c, i) => c.classList.toggle('on', i === ci));
    boards.forEach((b) => b.update(p));
  }
  let raf = 0;
  S.on(window, 'scroll', () => {
    if (pinOn && !raf) raf = S.raf(() => { raf = 0; updatePin(); });
  }, { passive: true });

  /* ---------- STACKED (phones, reduced motion): vertical ticker, the chevron gate pushes fits down into the column ---------- */
  const track = $('#tkTrack'), scol = $('#scol'), gate = $('#gate'), tkEl = $('#tk');
  const TK = { seq: [] as Array<{ i: number; m: number }>, pos: 0, landed: 0, t: 0, vis: false, busy: false, gen: 0, n: 0 };
  function tkRow(M: ModeDef, idx: number, isM: number | boolean) {
    const it = M.flood[idx], isJob = M === MODES.bench;
    const meta = (isJob
      ? [okLoc((it as SnapJob).loc) ? (it as SnapJob).loc.split(',')[0] : (it as SnapJob).type]
      : [(it as SnapCon).visa, okLoc(it.loc) ? it.loc : '', it.exp ? it.exp + ' yrs' : '']
    ).filter(Boolean).slice(0, 2).join(' · ');
    const d = document.createElement('div');
    d.className = 'tk-row';
    if (isM) d.dataset.m = String(idx);
    d.innerHTML = `<i></i><b>${esc(isJob ? it.t : tc(it.t))}</b><span>${esc(meta)}</span><em>Fits</em>`;
    return d;
  }
  function buildStack() {
    texts(MODES[side === 'both' ? 'vendor' : side].cols.reduce((a, c) => a + c.m.length, 0));
    const sm = stackMode(), M = MODES[sm], mAll = M.cols[0].m, pre = mAll[mAll.length - 1], m = mAll.slice(0, -1);
    const all = new Set(M.cols.flatMap((c) => c.m));
    const noise = M.flood.map((_, i) => i).filter((i) => !all.has(i));
    const hasMeta = (i: number) => { const x = M.flood[i] as SnapCon; return !!(x.visa || x.exp || okLoc(x.loc)); };
    noise.sort((a, b) => Number(hasMeta(b)) - Number(hasMeta(a)) || a - b);
    const pat = [1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0];
    let ni = 0, mi = 0;
    TK.seq = pat.map((x) => (x ? { i: m[mi++], m: 1 } : { i: noise[5 + ((ni++ * 2) % (noise.length - 5))], m: 0 }));
    // pad the sequence with more noise so the ticker shows variety
    TK.seq = TK.seq.concat(noise.slice(12, 20).map((i) => ({ i, m: 0 })));
    track.innerHTML = '';
    track.style.transform = 'none';
    const startRows = RM
      ? [{ i: noise[1], m: 0 }, { i: m[0], m: 1 }, { i: noise[4], m: 0 }, { i: m[1], m: 1 }]
      : noise.slice(0, 4).map((i) => ({ i, m: 0 }));
    startRows.forEach((r) => { const el = tkRow(M, r.i, r.m); if (r.m) el.classList.add('fit'); track.appendChild(el); });
    TK.gen = TK.gen + 1; TK.pos = 0; TK.landed = 0; TK.busy = false;
    scol.classList.remove('clear');
    const shown = RM ? [m[0], pre] : [pre];
    scol.innerHTML = colHTML(sm, 0, shown.length, shown.map((i) => M.card(M.flood[i], true)).join(''));
    $('.col-b', scol).insertAdjacentHTML('afterbegin', '<div class="ph">Next fit lands here</div>');
    scol.classList.toggle('full', shown.length >= 2);
    TK.n = shown.length;
    tkRun();
  }
  function tkTick() {
    if (TK.busy) return;
    TK.busy = true;
    const gen = TK.gen;
    const sm = stackMode(), M = MODES[sm], rows = track.children, bottom = rows[rows.length - 1] as HTMLElement;
    if (!bottom) { TK.busy = false; return; }
    const isM = !!bottom.dataset.m;
    bottom.classList.add(isM ? 'drop' : 'out');
    S.timeout(() => {
      if (gen !== TK.gen) return;
      if (isM) {
        gate.classList.remove('go'); reflow(gate); gate.classList.add('go');
        const sl = $('.slots', scol);
        const card = htmlEl(M.card(M.flood[+(bottom.dataset.m as string)], true));
        $('.tc-f span', card).textContent = 'Pushed just now';
        card.classList.add('enter');
        sl.prepend(card);
        while (sl.children.length > 2) sl.lastElementChild?.remove();
        TK.landed++; TK.n++;
        $('[data-new]', scol).textContent = String(TK.n);
        scol.classList.add('full');
      }
      bottom.remove();
      const nx = TK.seq[TK.pos % TK.seq.length];
      TK.pos++;
      track.prepend(tkRow(M, nx.i, nx.m));
      track.style.transition = 'none';
      track.style.transform = 'translateY(-40px)';
      void track.offsetHeight;
      track.style.transition = 'transform .45s cubic-bezier(.22,1,.36,1)';
      track.style.transform = 'none';
      const nb = track.children[track.children.length - 1] as HTMLElement;
      if (nb.dataset.m) nb.classList.add('fit');
      if (TK.landed >= 2) {
        S.clearInterval(TK.t); TK.t = 0;
        S.timeout(() => {
          if (gen !== TK.gen) return;
          scol.classList.add('clear');
          S.timeout(() => {
            if (gen !== TK.gen) return;
            const sl = $('.slots', scol);
            const pre = M.cols[0].m[M.cols[0].m.length - 1];
            sl.innerHTML = M.card(M.flood[pre], true);
            TK.n = 1;
            $('[data-new]', scol).textContent = '1';
            scol.classList.remove('clear', 'full');
            TK.landed = 0; TK.pos = 0; TK.busy = false;
            tkRun();
          }, 450);
        }, 2600);
        return;
      }
      TK.busy = false;
    }, 380);
  }
  function tkRun() {
    S.clearInterval(TK.t); TK.t = 0;
    if (!RM && !pinOn && TK.vis && !document.hidden && !TK.busy && TK.landed < 2) TK.t = S.interval(tkTick, 760);
  }

  /* ---------- EMAILS: AI Request (vendor) and AI Submit (bench), same real match ---------- */
  const j0 = D.jobs[14], c0 = D.hotlist[21], ct0 = tc(c0.t);
  const MAILDATA: Record<Mode, { to: string; sub: string; body: string; extra: string; facts: string[]; pair: string[][] }> = {
    bench: {
      to: 'The recruiter on this requirement', sub: `${ct0}: ${c0.exp} yrs, ${c0.visa}`,
      body: `Hi,\n\nI have a ${ct0} with ${c0.exp} years of experience, on ${c0.visa} and open to relocate, for your ${j0.t} role in ${j0.loc} (${j0.type}).\n\nResume attached. Happy to share rate and availability.`,
      extra: '<span class="att"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/></svg>Resume.pdf</span>',
      facts: ['Submissions: free, unlimited', 'AI Submit draft: 1 credit', 'Gmail send: 1 credit, refunded if it fails'],
      pair: [[c0.exp + ' yrs · ' + c0.visa + ' · Open to relocate', ct0, ''], [jobSub(j0), j0.t, ' o']],
    },
    vendor: {
      to: 'The recruiter on this consultant', sub: `${ct0}: resume and rate?`,
      body: `Hi,\n\nI have a ${j0.t} requirement (${j0.loc}, ${j0.type}) that fits your ${ct0} consultant.\n\nCould you share their resume, rate, visa status and availability?`,
      extra: '<div class="chk"><span class="ddc" aria-hidden="true"><i></i><i></i></span>Optional: add a video screening link</div>',
      facts: ['AI Request drafts: free', 'Gmail send: 1 credit, refunded if it fails', 'Optional video screening'],
      pair: [[jobSub(j0), j0.t, ' o'], [c0.exp + ' yrs · ' + c0.visa + ' · Open to relocate', ct0, '']],
    },
  };
  const MAILS = $$('.mg').map((r) => ({ root: r, mode: r.dataset.mode as Mode, fig: $('.mail', r), seen: false, timer: 0 }));
  function renderMail(m: (typeof MAILS)[number], type: boolean) {
    const d = MAILDATA[m.mode], r = m.root;
    $('.pushrow', r).classList.remove('go');
    $('.m-to', r).textContent = d.to;
    $('.m-sub', r).textContent = d.sub;
    $('.m-extra', r).innerHTML = d.extra;
    $('.facts', r).innerHTML = d.facts.map((f) => `<span class="fact">${esc(f)}</span>`).join('');
    $('.pc', r).innerHTML = d.pair.map((p) => `<div class="mini"><span class="dot${p[2]}"></span><div><b>${esc(p[1])}</b><span>${esc(p[0])}</span></div></div>`).join('');
    const bd = $('.mbody', r);
    S.clearTimeout(m.timer);
    if (!type || RM) { bd.textContent = d.body; return; }
    bd.textContent = '';
    const tn = document.createTextNode('');
    const car = document.createElement('span');
    car.className = 'caret';
    bd.append(tn, car);
    let i = 0;
    const step = () => {
      i += 2;
      tn.data = d.body.slice(0, i);
      if (i < d.body.length) m.timer = S.timeout(step, 32);
      else S.timeout(() => { car.remove(); $('.pushrow', r).classList.add('go'); }, 600);
    };
    m.timer = S.timeout(step, 350);
  }

  /* ---------- LIVE TRACKER: one column per side ---------- */
  const POOLS: Record<Mode, number[]> = { bench: [14, 19, 24, 20, 36], vendor: [21, 9, 37, 7, 35] };
  const LIVES = $$('.lw').map((r) => ({ root: r, mode: r.dataset.mode as Mode, host: $('.col-host', r), toast: $('.toast', r), step: 0, t: 0, vis: false, started: false }));
  type Live = (typeof LIVES)[number];
  function renderLive(L: Live) {
    const M = MODES[L.mode], pool = POOLS[L.mode];
    const n = RM ? 4 : 3;
    L.host.innerHTML = colHTML(L.mode, 0, n, pool.slice(0, n).map((i) => M.card(M.flood[i], true)).join(''));
    L.step = 0;
  }
  function liveTick(L: Live) {
    const M = MODES[L.mode], pool = POOLS[L.mode], sl = $('.slots', L.host), nEl = $('[data-new]', L.host);
    if (!sl) return;
    const add = (idx: number) => {
      const el = htmlEl(M.card(M.flood[idx], true));
      $('.tc-f span', el).textContent = 'Posted just now';
      el.classList.add('enter');
      sl.prepend(el);
      nEl.textContent = String(sl.children.length);
      return el;
    };
    L.step++;
    if (L.step === 1) {
      const el = add(pool[3]);
      $('.toast-t', L.toast).textContent = $('.tc-t', el).textContent;
      L.toast.classList.add('on');
      S.timeout(() => L.toast.classList.remove('on'), 2600);
    } else if (L.step === 2) add(pool[4]);
    else if (L.step === 3) {
      const el = sl.children[sl.children.length - 1] as HTMLElement;
      $('.tc-h', el).insertAdjacentHTML('beforeend', '<span class="tag mg2">Repost merged</span>');
      el.style.borderColor = '#8b5cf6';
    } else if (L.step === 4) {
      const el = sl.children[0] as HTMLElement;
      $('.tc-h', el).insertAdjacentHTML('beforeend', '<span class="tag nm">Not a match</span>');
      S.timeout(() => {
        el.classList.add('gone');
        S.timeout(() => { el.remove(); nEl.textContent = String(sl.children.length); }, 500);
      }, 900);
    } else if (L.step === 5) (sl.children[0] as HTMLElement).style.borderColor = '#2563eb';
    else {
      const col = $('.col', L.host);
      col.style.opacity = '.25';
      S.timeout(() => renderLive(L), 400);
    }
  }
  function liveRun(L: Live) {
    S.clearInterval(L.t); L.t = 0;
    if (!RM && L.vis && !document.hidden && L.started) L.t = S.interval(() => liveTick(L), 3000);
  }

  /* ---------- side switch ---------- */
  function placeKnobs() {
    $$('.switch').forEach((sw) => {
      const k = $('.knob', sw), lab = side === 'vendor' ? $('.lv', sw) : side === 'bench' ? $('.lb', sw) : $('.mid', sw);
      if (!lab.offsetWidth) return;
      k.style.width = lab.offsetWidth + 'px';
      k.style.transform = `translateX(${lab.offsetLeft - 5}px)`;
    });
  }
  function setSide(s: Side) {
    if (s === side) return;
    side = s;
    root.dataset.side = s;
    $$<HTMLInputElement>('.switch input').forEach((r) => (r.checked = r.value === s));
    placeKnobs();
    setSplit();
    if (pinOn) buildPin();
    buildStack();
  }
  $$<HTMLInputElement>('.switch input').forEach((r) => S.on(r, 'change', () => { if (r.checked) setSide(r.value as Side); }));
  /* tap the active side again to go back to both */
  $$<HTMLLabelElement>('.switch label.lv,.switch label.lb').forEach((l) =>
    S.on(l, 'click', (e) => {
      const inp = root.querySelector<HTMLInputElement>('#' + l.htmlFor);
      if (inp && inp.checked) { e.preventDefault(); setSide('both'); }
    }),
  );
  function setPick(p: Mode) {
    if (p === pick) return;
    pick = p;
    root.dataset.pick = p;
    $$('.pick button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === p)));
    buildStack();
  }
  $$('.pick').forEach((g) =>
    S.on(g, 'click', (e) => {
      const b = (e.target as Element).closest<HTMLElement>('button');
      if (b) setPick(b.dataset.pick as Mode);
    }),
  );

  /* ---------- layout mode ---------- */
  const wantPin = () => !RM && innerWidth >= 900 && innerHeight >= 720 && innerHeight <= 1400;
  function applyLayout() {
    const w = wantPin();
    if (w !== pinOn) {
      pinOn = w;
      root.classList.toggle('pin', w);
      if (w) buildPin(); else buildStack();
    } else if (pinOn) layoutPin();
  }
  let rz = 0, lastW = innerWidth;
  S.on(window, 'resize', () => {
    S.clearTimeout(rz);
    rz = S.timeout(() => {
      const wc = innerWidth !== lastW;
      lastW = innerWidth;
      placeKnobs();
      if (pinOn && wc && wantPin()) { buildPin(); return; }
      applyLayout();
      if (!pinOn && wc) buildStack();
    }, 150);
  });

  /* ---------- observers ---------- */
  const numsEl = $('#nums');
  const io = S.observe((es) => es.forEach((e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('rv') && e.isIntersecting) { t.classList.add('in'); if (!t.classList.contains('lw')) io.unobserve(t); }
    if (t === tkEl) { TK.vis = e.isIntersecting; tkRun(); }
    const m = MAILS.find((x) => x.fig === t);
    if (m && e.isIntersecting && !m.seen) { m.seen = true; renderMail(m, true); }
    const L = LIVES.find((x) => x.root === t);
    if (L) {
      L.vis = e.isIntersecting;
      if (L.vis && !L.started) S.timeout(() => { L.started = true; liveRun(L); }, L.mode === 'vendor' ? 1500 : 3000);
      liveRun(L);
    }
    if (t === numsEl && e.isIntersecting) { if (!RM) $$('.n', numsEl).forEach((el) => countUp(S, el, 1400, 3)); io.unobserve(t); }
  }), { threshold: 0.3 });
  S.on(document, 'visibilitychange', () => { LIVES.forEach(liveRun); tkRun(); });

  /* ---------- hero torrent (canvas): consultants on the vendor side, requirements on the bench side ---------- */
  const hero = $('.hero');
  let heroReady = false;
  const torrentWords = (d: StoryData) => ({
    v: d.hotlist.map((c) => ({ t: tc(c.t), m: ['Consultant', c.visa, c.exp ? c.exp + ' yrs' : ''].filter(Boolean).join(' · ') })),
    b: d.jobs.map((j) => ({ t: j.t, m: ['Requirement', j.type, okLoc(j.loc) ? j.loc : ''].filter(Boolean).join(' · ') })),
  });
  const torrent = new Torrent(S, $<HTMLCanvasElement>('#torrent'), hero, {
    layers: [{ fs: 11, a: 0.35, v: 34, w: 190 }, { fs: 13, a: 0.5, v: 62, w: 228 }, { fs: 16, a: 0.7, v: 104, w: 282 }],
    mode: 'split',
    words: torrentWords(D),
    stroke: (v) => (v ? 'rgba(37,99,235,.45)' : 'rgba(234,88,12,.45)'),
    meta: (v) => (v ? '#2563eb' : '#c2410c'),
    ready: () => heroReady,
  }, RM);
  function setSplit() {
    torrent.split = side === 'both' ? 0.5 : side === 'vendor' ? 1.2 : -0.2;
    torrent.respawnAll();
  }

  /* ---------- phone bar ---------- */
  const mbar = $('#mbar');
  const mv = new Map<Element, boolean>();
  const barObs = S.observe((es) => {
    es.forEach((e) => mv.set(e.target, e.isIntersecting));
    mbar.classList.toggle('away', [...mv.values()].some(Boolean));
  });
  barObs.observe($('#zones'));
  barObs.observe($('.final'));
  if (opts.footer) barObs.observe(opts.footer);

  /* ---------- hero counts ---------- */
  const heroNums = [$('#nV'), $('#nB')];
  function heroCount() {
    if (RM) return;
    heroNums.forEach((el) => countUp(S, el, 1300, 4));
  }

  wireLinks(S, root, opts.navigate, RM);

  /* ---------- boot ---------- */
  MAILS.forEach((m) => renderMail(m, false));
  LIVES.forEach(renderLive);
  torrent.size();
  torrent.draw(0);
  heroCount();
  placeKnobs();
  applyLayout();
  if (!pinOn) buildStack();
  [...$$('.rv'), tkEl, ...MAILS.map((m) => m.fig), ...LIVES.map((l) => l.root), numsEl].forEach((e) => io.observe(e));
  S.timeout(() => { heroReady = true; torrent.loop(); }, 1500);
  S.timeout(() => {
    root.classList.add('done');
    heroNums.forEach((el) => { if (el.dataset.counting !== '1') el.textContent = fmt(+(el.dataset.n || 0)); });
  }, 2000);
  S.timeout(() => $$('.rv').forEach((e) => e.classList.add('in')), 5000);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (!S.alive) return;
      torrent.size(); torrent.draw(0); placeKnobs();
      if (pinOn) layoutPin(); else buildStack();
    });
  }

  /* ---------- auto-toggle: Both -> Vendor -> Bench sales -> Both ... without a tap ----------
     Runs while the hero switch is on screen and the tab is visible. A tap, key or focus on a
     side control (the switches and the phone pickers) stops it for good on the side the visitor
     chose. Touching anything else it changes (the hero zones, the filter story, the emails, the
     Tracker, the phone bar) pauses it. Once the visitor scrolls past the hero without having
     picked a side, it stops and settles back on "Both", so the rest of the page tells both
     stories instead of whichever side happened to be showing. */
  (function autoToggle() {
    const sw = $('.hero .switch');
    if (RM || !sw) return;
    const SEQ: Side[] = ['both', 'vendor', 'bench'];
    const DWELL = 4500, START = 2500;
    /* hold the hero at its tallest ("both") height while auto-switching so nothing below it moves */
    let locked = false;
    function lock() {
      if (locked || side !== 'both') return;
      locked = true;
      hero.style.minHeight = hero.offsetHeight + 'px';
      if (innerWidth < 900) hero.style.alignItems = 'flex-start';
    }
    function unlock() {
      if (!locked) return;
      locked = false;
      hero.style.minHeight = '';
      hero.style.alignItems = '';
    }
    S.add(unlock);
    const controls = [...$$('.switch'), ...$$('.pick')];
    const zones = [...controls, $('#zones'), $('#filter'), $('.mailsec'), $('#tracker'), mbar].filter(Boolean);
    let stopped = false, paused = false, picked = false, ready = false, vis = true, timer = 0;
    function hint(on: boolean, ms?: number) {
      sw.classList.remove('auto');
      if (on) { sw.style.setProperty('--apd', ms + 'ms'); reflow(sw); sw.classList.add('auto'); }
    }
    const can = () => !stopped && !paused && ready && vis && !document.hidden;
    function arm(ms: number) {
      S.clearTimeout(timer); timer = 0;
      if (!can()) { hint(false); return; }
      hint(true, ms);
      timer = S.timeout(flip, ms);
    }
    function flip() {
      timer = 0;
      if (!can()) return arm(DWELL);
      lock();
      setSide(SEQ[(SEQ.indexOf(side) + 1) % SEQ.length]);
      arm(DWELL);
    }
    const offResize = S.on(window, 'resize', () => { if (locked && !stopped) { unlock(); if (side === 'both') lock(); } });
    function release() {
      /* release the height hold only if the hero bottom is below the fold, so the shrink is never seen */
      if (hero.getBoundingClientRect().bottom >= innerHeight) unlock();
    }
    function halt() {
      S.clearTimeout(timer); timer = 0;
      hint(false);
    }
    function stop(settle: boolean) {
      if (stopped) return;
      stopped = true;
      halt();
      vo.disconnect();
      offUser.forEach((f) => f());
      offScroll(); offVis(); offResize();
      if (settle && !picked && side !== 'both') setSide('both');
      release();
    }
    function onUser(e: Event) {
      const t = e.target as Node | null;
      if (!t || t.nodeType !== 1) return;
      if (controls.some((z) => z.contains(t))) { picked = true; stop(false); return; }
      if (zones.some((z) => z.contains(t)) && !paused) { paused = true; halt(); }
    }
    function onScroll() { if (scrollY > hero.offsetHeight * 0.5) stop(true); }
    const vo = S.observe((es) => {
      const v = es[es.length - 1].isIntersecting;
      if (v !== vis) { vis = v; arm(DWELL); }
    }, { threshold: 0.9 });
    vo.observe(sw);
    const offUser = (['pointerdown', 'keydown', 'focusin'] as const).map((t) => S.on(document, t, onUser, true));
    const offScroll = S.on(window, 'scroll', onScroll, { passive: true });
    const offVis = S.on(document, 'visibilitychange', () => arm(DWELL));
    /* the bar starts filling with the intro so the first switch at START never looks sudden */
    S.timeout(() => { ready = true; arm(START - 900); }, 900);
  })();

  return {
    update(next: StoryData) {
      D = { ...D, stats: next.stats, asOf: next.asOf };
      applyStats(root, D);
      texts(lastFit);
      torrent.setWords(torrentWords(next));
    },
    dispose() {
      S.dispose();
      root.classList.remove('pin');
    },
  };
}
