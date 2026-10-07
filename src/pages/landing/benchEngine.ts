// /bench-sales engine: hero torrent of real requirements, the pasted hotlist
// turning into columns, the pinned scroll-driven push on desktop (with a
// repost merged into one card), the phone ticker and pull, the AI Submit
// email, inbound resume requests, the live Tracker column, the screening
// wave, count-ups and the phone bar. Ported from
// website-demos/profilepush-ai/bench-sales.

import {
  ICONS, Scope, Torrent, applyStats, cardMakers, clamp, countUp, ease, esc, fmt, htmlEl, jobSub, lerp, makeAgo,
  map, newestAt, okLoc, okWork, queries, reducedMotion, reflow, rng, tc, wireLinks, workLabel,
} from './engine';
import type { EngineOptions, PageEngine, SnapCon, SnapJob, StoryData } from './engine';

interface FloodCard {
  el: HTMLElement; i: number; m: { ci: number; k: number; rp?: boolean } | null;
  s0: number; w: number; x0: number; y0: number; r0: number; dir: number; b0: number; o0: number; fall: number; tx: number; ty: number;
}

export function startBench(root: HTMLElement, data: StoryData, opts: EngineOptions): PageEngine {
  const S = new Scope();
  const RM = reducedMotion();
  const { $, $$ } = queries(root);
  let D = data;
  const ago = makeAgo(newestAt(D));
  const { jobCard } = cardMakers(ago);
  const conSub = (c: SnapCon) =>
    [c.exp ? c.exp + ' yrs' : '', c.visa, okLoc(c.loc) ? c.loc : okWork(c.work) ? workLabel(c.work) : ''].filter(Boolean).join(' · ');

  /* consultants (real hotlist rows) and the real reqs that fit them */
  const H = D.hotlist;
  const COLS = [{ h: H[21], m: [14, 19, 24] }, { h: H[0], m: [27, 4, 38] }, { h: H[20], m: [6, 30] }];
  const REPOST = { idx: 32, of: 4, ci: 1, k: 1 }; /* "Hybrid/Local Govt Azure Data Engineer" = repost of "Azure Data Engineer", same city and skills */
  const FLOOD = D.jobs;
  const mgTag = (cls?: string) => `<span class="tag mg ${cls || ''}">Repost merged</span>`;
  function colHTML(ci: number, newN: number, body: string) {
    const c = COLS[ci];
    return `<div class="col c${ci}"><div class="col-h"><div class="h"><span class="dot"></span>${esc(tc(c.h.t))}</div><p>${esc(conSub(c.h))}</p>
  <div class="pills"><span class="pill">New <b data-new>${newN}</b></span><span class="pill mu">Submitted <b data-sub>0</b></span></div></div>
  <div class="col-b"><div class="slots">${body}</div></div></div>`;
  }

  /* ---------- 1. PASTE ---------- */
  const PASTE = [H[21], H[0], H[20], H[17], H[19]];
  $('#ptab').innerHTML = PASTE.map((c, i) => `<tr style="animation-delay:${(i * 0.06).toFixed(2)}s"><td>${esc(tc(c.t))}</td><td>${c.exp} yrs</td><td>${esc(c.visa)}</td><td>${esc(okLoc(c.loc) ? c.loc : workLabel(c.work))}</td></tr>`).join('');
  $('#heads').innerHTML = PASTE.map((c, i) => `<div class="mh c${i}"><div class="top2"><b>${esc(tc(c.t))}</b><span>${esc([c.exp + ' yrs', c.visa].join(' · '))}</span></div><div class="bot"><span class="ldr"><i></i><i></i><svg viewBox="0 0 10 16"><use href="#ddc"/></svg></span>Matching reqs</div></div>`).join('');
  const pbox = $('#pbox');
  function sizeScan() {
    const sr = $('.sheet', pbox).getBoundingClientRect(), tr = $('#ptab').getBoundingClientRect();
    pbox.style.setProperty('--s0', tr.top - sr.top - 44 + 'px');
    pbox.style.setProperty('--sh', tr.bottom - sr.top - 44 + 'px');
  }

  /* ---------- 2. PINNED (desktop) ---------- */
  const pinEl = $('#fxPin'), board = $('#board');
  let cards: FloodCard[] = [], cols: HTMLElement[] = [], boardW = 0, boardH = 0, sweepEl: HTMLElement | null = null, pinOn: boolean | null = false, target4: HTMLElement | null = null, lastP = -1;
  const caps = $$('.cap'), fitEl = $('#fxFit');
  function buildPin() {
    const colsHTML = COLS.map((c, ci) => colHTML(ci, 0, c.m.map((_, k) => `<div class="slot" data-c="${ci}" data-k="${k}"></div>`).join(''))).join('');
    board.innerHTML = `<div class="cols">${colsHTML}</div><div class="field"></div><div class="sweep"><svg viewBox="0 0 150 600" preserveAspectRatio="none"><defs><linearGradient id="sg" x1="0" x2="1"><stop offset="0" stop-color="#2563eb" stop-opacity="0"/><stop offset="1" stop-color="#2563eb" stop-opacity=".35"/></linearGradient></defs><path d="M0 0 L110 300 L0 600 Z" fill="url(#sg)"/><path d="M40 6 L136 300 L40 594" fill="none" stroke="#2563eb" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>`;
    sweepEl = $<HTMLElement>('.sweep', board);
    cols = $$('.col', board);
    const field = $('.field', board);
    const matchOf: Record<number, { ci: number; k: number; rp?: boolean }> = {};
    COLS.forEach((c, ci) => c.m.forEach((idx, k) => (matchOf[idx] = { ci, k })));
    matchOf[REPOST.idx] = { ci: REPOST.ci, k: REPOST.k, rp: true };
    cards = FLOOD.map((item, i) => {
      const el = document.createElement('div');
      el.className = 'fc';
      el.innerHTML = jobCard(item, false, i === REPOST.of ? mgTag('pm') : '');
      field.appendChild(el);
      return { el, i, m: matchOf[i] || null, s0: 0, w: 0, x0: 0, y0: 0, r0: 0, dir: 1, b0: 0, o0: 0, fall: 0, tx: 0, ty: 0 };
    });
    target4 = cards[REPOST.of].el;
    layoutPin();
  }
  function layoutPin() {
    if (!cards.length) return;
    const br = board.getBoundingClientRect();
    boardW = br.width; boardH = br.height;
    cols.forEach((c) => (c.style.transform = 'none'));
    const slots = $$('.slot', board);
    const cw = slots[0].getBoundingClientRect().width;
    const R = rng(7);
    cards.forEach((c) => {
      c.el.style.width = cw + 'px';
      const s0 = c.m ? 0.5 + R() * 0.12 : 0.38 + R() * 0.34;
      c.s0 = s0; c.w = cw;
      c.x0 = R() * (boardW - cw * s0);
      c.y0 = c.m ? (0.08 + R() * 0.7) * (boardH - 116 * s0) : (R() * 1.15 - 0.1) * (boardH - 116 * s0);
      c.r0 = (R() - 0.5) * 12; c.dir = R() < 0.5 ? -1 : 1;
      c.b0 = c.m ? 1.6 : 1 + (0.72 - s0) * 7;
      c.o0 = c.m ? 0.62 : 0.28 + (s0 - 0.38) * 1.3;
      c.fall = 0.6 + R() * 0.5;
      if (c.m) {
        const m = c.m;
        const sl = slots.find((s) => +(s.dataset.c as string) === m.ci && +(s.dataset.k as string) === m.k);
        if (sl) { const r = sl.getBoundingClientRect(); c.tx = r.left - br.left; c.ty = r.top - br.top; }
      }
    });
    lastP = -1;
    updatePin(true);
  }
  function updatePin(force?: boolean) {
    if (!sweepEl) return;
    const r = pinEl.getBoundingClientRect();
    const total = r.height - innerHeight;
    const p = clamp(-r.top / total);
    if (!force && Math.abs(p - lastP) < 0.0005) return;
    lastP = p;
    const ci = p < 0.17 ? 0 : p < 0.5 ? 1 : 2;
    caps.forEach((c, i) => c.classList.toggle('on', i === ci));
    const s = map(p, 0.14, 0.5);
    const sx = -160 + s * (boardW + 320);
    sweepEl.style.opacity = s > 0 && s < 1 ? '1' : '0';
    sweepEl.style.transform = `translateX(${sx}px)`;
    const g = ease(map(p, 0.5, 0.8));
    const drift = p * 90;
    let fits = 0;
    for (const c of cards) {
      const cx = c.x0 + (c.w * c.s0) / 2;
      const k = clamp((sx + 130 - cx) / 180);
      let x = c.x0, y = c.y0 + drift * (1 - c.s0), sc = c.s0, rot = c.r0, o = c.o0, b = c.b0;
      if (!c.m) {
        const f = k * k;
        y += f * boardH * c.fall; x += f * 40 * c.dir; rot += f * 26 * c.dir; o = c.o0 * (1 - k); b = c.b0 + k * 5;
        if (o < 0.01) { c.el.style.visibility = 'hidden'; continue; }
        c.el.style.visibility = '';
      } else {
        b = c.b0 * (1 - k); o = lerp(c.o0, 1, k);
        sc = lerp(c.s0, c.s0 * 1.12, k);
        if (k > 0.6 && !c.m.rp) fits++;
        c.el.classList.toggle('hit', k > 0.6 && g < 0.98 && !c.m.rp);
        c.el.classList.toggle('rp', !!c.m.rp && k > 0.6);
        x = lerp(x, c.tx, g); y = lerp(y, c.ty, g); sc = lerp(sc, 1, g); rot = lerp(rot, 0, g);
        if (c.m.rp) { o = o * (1 - map(g, 0.82, 0.98)); c.el.style.visibility = o < 0.01 ? 'hidden' : ''; }
      }
      c.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
      c.el.style.opacity = o.toFixed(3);
      c.el.style.filter = b > 0.05 ? `blur(${b.toFixed(1)}px)` : 'none';
      c.el.style.zIndex = c.m ? (c.m.rp ? '3' : '2') : '1';
    }
    target4?.classList.toggle('merged', g > 0.9);
    fitEl.textContent = String(fits);
    const ch = map(p, 0.46, 0.62);
    cols.forEach((col, i) => {
      col.style.opacity = String(ch);
      col.style.transform = `translateY(${(1 - ch) * 24}px)`;
      const n = String(Math.round(map(p, 0.78 + i * 0.02, 0.86 + i * 0.02) * COLS[i].m.length));
      const e = $('[data-new]', col);
      if (e.textContent !== n) e.textContent = n;
    });
  }
  let raf = 0;
  S.on(window, 'scroll', () => {
    if (pinOn && !raf) raf = S.raf(() => { raf = 0; updatePin(); });
  }, { passive: true });

  /* ---------- 2. STACKED (phones, reduced motion): ticker + vertical pull ---------- */
  const seg = $('#seg'), scol = $('#scol'), tickL = $('#tickL'), pullEl = $('#pull');
  let tabI = 0;
  const SHORT = ['Java', 'Power BI', 'CyberArk'];
  const ALLM = new Set(COLS.flatMap((c) => c.m).concat(REPOST.idx));
  const NOISE = FLOOD.map((_, i) => i).filter((i) => !ALLM.has(i));
  const tRow = (idx: number, cls?: string, tag?: string) => {
    const j = FLOOD[idx];
    const meta = [okLoc(j.loc) ? j.loc.split(',')[0] : '', j.type].filter(Boolean).join(' · ');
    return `<div class="tr ${cls || ''}"><b>${esc(j.t)}</b>${tag || `<span>${esc(meta)}</span>`}</div>`;
  };
  const TROWS = 5;
  let nI = 0, queue: number[] = [], tickT = 0, tickN = 0, tickVis = false, placed = 0, doneAt = 0;
  const PH = '<div class="ph-slot"><span class="ldr"><i></i><i></i><svg viewBox="0 0 10 16"><use href="#ddc"/></svg></span>Next fit lands here</div>';
  const cardEl = (idx: number) => { const el = htmlEl(jobCard(FLOOD[idx], true)); el.dataset.idx = String(idx); return el; };
  function renderScol() {
    const c = COLS[tabI];
    seg.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', String(i === tabI)));
    if (RM) { scol.innerHTML = colHTML(tabI, c.m.length, c.m.map((i) => jobCard(FLOOD[i], true, i === REPOST.of ? mgTag() : '')).join('')); return; }
    scol.innerHTML = colHTML(tabI, 1, PH);
    $('.slots', scol).append(cardEl(c.m[0]));
    queue = c.m.slice(1);
    if (tabI === REPOST.ci) queue.splice(queue.indexOf(REPOST.of) + 1, 0, REPOST.idx);
    placed = 1; doneAt = 0; tickN = 0;
  }
  function seedTicker() {
    tickL.innerHTML = '';
    for (let k = 0; k < TROWS; k++) tickL.insertAdjacentHTML('beforeend', tRow(NOISE[nI++ % NOISE.length]));
  }
  function pull(row: HTMLElement, idx: number) {
    row.classList.add('out');
    pullEl.classList.remove('go'); reflow(pullEl); pullEl.classList.add('go');
    const nEl = scol.querySelector('[data-new]');
    if (idx === REPOST.idx) {
      const t = scol.querySelector(`[data-idx="${REPOST.of}"]`);
      if (t) { $('.tc-h', t).insertAdjacentHTML('beforeend', mgTag()); t.classList.add('flash'); }
    } else {
      const sl = $('.slots', scol), ph = scol.querySelector('.ph-slot');
      const el = cardEl(idx);
      el.classList.add('enter');
      if (ph) ph.after(el); else sl.prepend(el);
      placed++;
      if (nEl) nEl.textContent = String(placed);
      const cs = $$('.tc', sl);
      if (cs.length > 3) cs[cs.length - 1].remove();
    }
    if (!queue.length) scol.querySelector('.ph-slot')?.remove();
    S.timeout(() => row.remove(), 450);
  }
  function tick() {
    tickN++;
    let idx: number, cls = '', tag = '', isM = false;
    if (queue.length && tickN % 3 === 1) {
      idx = queue.shift() as number;
      isM = true;
      cls = 'hit';
      tag = idx === REPOST.idx ? '<span class="tag mg">Repost</span>' : '<span class="tag ok">Fits</span>';
    } else idx = NOISE[nI++ % NOISE.length];
    tickL.insertAdjacentHTML('afterbegin', tRow(idx, cls + ' in', tag));
    const first = tickL.firstElementChild as HTMLElement;
    const rows = [...tickL.children].filter((r) => !r.classList.contains('out'));
    if (rows.length > TROWS) rows[rows.length - 1].remove();
    if (isM) S.timeout(() => pull(first, idx), 900);
    if (!queue.length && !doneAt) doneAt = tickN;
    if (doneAt && tickN - doneAt > 10) {
      scol.style.opacity = '.3';
      S.timeout(() => { renderScol(); scol.style.opacity = '1'; }, 350);
    }
  }
  function tickRun() {
    S.clearInterval(tickT); tickT = 0;
    if (!RM && !pinOn && tickVis && !document.hidden) tickT = S.interval(tick, 700);
  }
  function buildStack() {
    seg.innerHTML = SHORT.map((s, i) => `<button type="button" role="tab" aria-selected="${i === tabI}" data-i="${i}">${s}</button>`).join('');
    seedTicker();
    renderScol();
  }
  S.on(seg, 'click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button');
    if (!b) return;
    tabI = +(b.dataset.i as string);
    renderScol();
    tickRun();
  });
  scol.style.transition = 'opacity .35s';
  S.on(document, 'visibilitychange', tickRun);

  /* ---------- 3. EMAIL (AI Submit) ---------- */
  let typeTimer = 0, mailSeen = false;
  const MJ = D.jobs[14], MC = H[21], MCT = tc(MC.t);
  const MAILBODY = `Hi,\n\nI have a ${MCT} with ${MC.exp} years of experience, on ${MC.visa} and open to relocate, for your ${MJ.t} role in ${MJ.loc} (${MJ.type}).\n\nResume attached. Happy to share rate and availability.`;
  $('#mSub').textContent = `${MCT}: ${MC.exp} yrs, ${MC.visa}`;
  $('#pair').innerHTML = [[MC.exp + ' yrs · ' + MC.visa + ' · Open to relocate', MCT, ''], [jobSub(MJ), MJ.t, ' o']]
    .map((p) => `<div class="mini"><span class="dot${p[2]}"></span><div><b>${esc(p[1])}</b><span>${esc(p[0])}</span></div></div>`).join('');
  function renderMail(type: boolean) {
    const body = $('#mBody');
    S.clearTimeout(typeTimer);
    $('#pushrow').classList.remove('go');
    if (!type || RM) { body.textContent = MAILBODY; return; }
    body.textContent = '';
    const tn = document.createTextNode('');
    const car = document.createElement('span');
    car.className = 'caret';
    body.append(tn, car);
    let i = 0;
    const step = () => {
      i += 2;
      tn.data = MAILBODY.slice(0, i);
      if (i < MAILBODY.length) typeTimer = S.timeout(step, 32);
      else S.timeout(() => { car.remove(); $('#pushrow').classList.add('go'); }, 600);
    };
    typeTimer = S.timeout(step, 350);
  }

  /* ---------- 4. INBOUND REQUESTS ---------- */
  const RQ: Array<{ c: SnapCon; j: SnapJob; st?: string }> = [
    { c: H[21], j: D.jobs[13] },
    { c: H[20], j: D.jobs[30], st: 'open' },
    { c: H[19], j: D.jobs[18], st: 'sent' },
  ];
  const rqRow = (r: (typeof RQ)[number], st?: string) => {
    const tag = st === 'sent' ? '<span class="tag ok">Resume sent</span>' : '<span class="tag am">Open</span>';
    const acts = st === 'sent'
      ? `<div class="acts2"><span class="ab done">${ICONS.ok}Resume.pdf</span><span class="ab done">${ICONS.ok}Note added</span></div>`
      : `<div class="acts2"><span class="ab" data-a="up">${ICONS.up}Upload resume</span><span class="ab" data-a="note">${ICONS.note}Add a note</span></div>`;
    return `<div class="rq"><span class="dot" aria-hidden="true"></span><div class="who"><b>${esc(tc(r.c.t))}</b><span>for ${esc(r.j.t)} · ${esc(jobSub(r.j))}</span></div>${tag}${acts}</div>`;
  };
  const rqList = $('#rqList'), reqOpen = $('#reqOpen');
  let rqT: number[] = [];
  function renderReqs(final: boolean) {
    rqT.forEach((id) => S.clearTimeout(id));
    rqT = [];
    if (final) { rqList.innerHTML = RQ.map((r, i) => rqRow(r, i === 0 ? 'open' : r.st)).join(''); reqOpen.textContent = '2 open'; return; }
    rqList.innerHTML = RQ.slice(1).map((r) => rqRow(r, r.st)).join('');
    reqOpen.textContent = '1 open';
  }
  function playReqs() {
    if (RM) return;
    renderReqs(false);
    const T = (ms: number, f: () => void) => rqT.push(S.timeout(f, ms));
    T(700, () => {
      rqList.insertAdjacentHTML('afterbegin', rqRow(RQ[0], 'open'));
      const el = rqList.firstElementChild as HTMLElement;
      el.classList.add('enter', 'fresh');
      reqOpen.textContent = '2 open';
      T(1400, () => el.classList.remove('fresh'));
    });
    T(2600, () => {
      const b = $('[data-a=up]', rqList);
      b.classList.add('press');
      T(220, () => { b.classList.remove('press'); b.classList.add('done'); b.innerHTML = ICONS.ok + 'Resume.pdf'; });
    });
    T(3700, () => {
      const b = $('[data-a=note]', rqList);
      b.classList.add('press');
      T(220, () => { b.classList.remove('press'); b.classList.add('done'); b.innerHTML = ICONS.ok + 'Note added'; });
    });
    T(4600, () => {
      const el = rqList.firstElementChild as HTMLElement;
      const tg = el.querySelector('.tag');
      if (tg) tg.outerHTML = '<span class="tag ok">Resume sent</span>';
      el.classList.add('fresh');
      reqOpen.textContent = '1 open';
      T(1200, () => el.classList.remove('fresh'));
    });
  }

  /* ---------- 5. LIVE TRACKER ---------- */
  const liveCol = $('#liveCol'), toast = $('#toast');
  let liveT = 0, liveStep = 0, liveVis = false, liveStarted = false;
  const POOL = [14, 19, 24, 20, 36];
  function renderLive() {
    const t = htmlEl(colHTML(0, 3, POOL.slice(0, 3).map((i) => jobCard(FLOOD[i], true)).join('')));
    liveCol.replaceChildren(...Array.from(t.childNodes));
    liveStep = 0;
    if (RM) {
      $('.slots', liveCol).innerHTML = POOL.slice(0, 4).map((i) => jobCard(FLOOD[i], true)).join('');
      $('[data-new]', liveCol).textContent = '4';
    }
  }
  function liveTick() {
    const sl = $('.slots', liveCol), nEl = $('[data-new]', liveCol), sEl = $('[data-sub]', liveCol);
    if (!sl) return;
    const add = (idx: number) => {
      const el = htmlEl(jobCard(FLOOD[idx], true));
      $('.tc-f span', el).textContent = 'Posted just now';
      el.classList.add('enter');
      sl.prepend(el);
      nEl.textContent = String(sl.children.length);
      return el;
    };
    liveStep++;
    if (liveStep === 1) {
      const el = add(POOL[3]);
      $('#toastT').textContent = $('.tc-t', el).textContent;
      toast.classList.add('on');
      S.timeout(() => toast.classList.remove('on'), 2600);
    } else if (liveStep === 2) add(POOL[4]);
    else if (liveStep === 3) {
      const el = sl.children[0] as HTMLElement;
      $('.tc-h', el).insertAdjacentHTML('beforeend', '<span class="tag nm">Not a match</span>');
      S.timeout(() => {
        el.classList.add('gone');
        S.timeout(() => { el.remove(); nEl.textContent = String(sl.children.length); }, 500);
      }, 900);
    } else if (liveStep === 4) {
      const el = sl.children[sl.children.length - 1] as HTMLElement;
      $('.tc-h', el).insertAdjacentHTML('beforeend', '<span class="tag ok">Submitted</span>');
      el.style.borderColor = '#2563eb';
      sEl.textContent = '1';
    } else if (liveStep === 5) {
      /* hold */
    } else {
      liveCol.style.opacity = '.25';
      S.timeout(() => { renderLive(); liveCol.style.opacity = '1'; }, 400);
    }
  }
  liveCol.style.transition = 'opacity .4s';
  function liveRun() {
    S.clearInterval(liveT); liveT = 0;
    if (!RM && liveVis && !document.hidden && liveStarted) liveT = S.interval(liveTick, 3000);
  }

  /* ---------- 6. SCREENING ---------- */
  $('#scrWho').textContent = `${MCT} · ${MC.exp} yrs · ${MC.visa}`;
  (function wave() {
    const R = rng(5);
    let h = '';
    for (let k = 0; k < 36; k++) {
      const v = Math.round(25 + R() * 70);
      h += `<i style="--h:${v};--k:${k}"${k < 14 ? ' class="p"' : ''}></i>`;
    }
    $('#wave').innerHTML = h;
  })();
  const scr = $('#scr');

  /* ---------- layout mode ---------- */
  const wantPin = () => !RM && innerWidth >= 900 && innerHeight >= 720 && innerHeight <= 1400;
  function applyLayout() {
    const w = wantPin();
    if (w !== pinOn) {
      pinOn = w;
      root.classList.toggle('pin', w);
      if (w) buildPin(); else buildStack();
      tickRun();
    } else if (pinOn) layoutPin();
  }
  let rz = 0;
  S.on(window, 'resize', () => {
    S.clearTimeout(rz);
    rz = S.timeout(() => { applyLayout(); sizeScan(); }, 150);
  });

  /* ---------- observers ---------- */
  let reqSeen = false;
  const mailEl = $('#mail'), reqsEl = $('#reqs'), liveWrap = $('#liveWrap'), numsEl = $('#nums');
  const io = S.observe((es) => es.forEach((e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('rv') && e.isIntersecting) t.classList.add('in');
    if (t === pbox && e.isIntersecting) { sizeScan(); pbox.classList.add('run'); io.unobserve(t); }
    if (t === tickL) { tickVis = e.isIntersecting; tickRun(); }
    if (t === mailEl && e.isIntersecting && !mailSeen) { mailSeen = true; renderMail(true); }
    if (t === reqsEl && e.isIntersecting && !reqSeen) { reqSeen = true; playReqs(); }
    if (t === scr) scr.classList.toggle('play-on', e.isIntersecting && !RM);
    if (t === liveWrap) {
      liveVis = e.isIntersecting;
      if (liveVis && !liveStarted) S.timeout(() => { liveStarted = true; liveRun(); }, 1500);
      liveRun();
    }
    if (t === numsEl && e.isIntersecting) { if (!RM) $$('.n', numsEl).forEach((el) => countUp(S, el, 1400, 3)); io.unobserve(t); }
  }), { threshold: 0.35 });
  S.on(document, 'visibilitychange', () => { liveRun(); if (document.hidden) scr.classList.remove('play-on'); });

  /* ---------- hero torrent (canvas): real requirements only ---------- */
  const hero = $('.hero');
  let heroReady = false;
  const torrentWords = (d: StoryData) => d.jobs.map((j) => ({
    t: j.t,
    m: [j.type, okLoc(j.loc) ? j.loc : '', j.exp && j.exp < 40 ? j.exp + ' yrs' : ''].filter(Boolean).join(' · '),
  }));
  const torrent = new Torrent(S, $<HTMLCanvasElement>('#torrent'), hero, {
    layers: [{ fs: 11, a: 0.22, v: 34, w: 190 }, { fs: 13, a: 0.34, v: 62, w: 228 }, { fs: 16, a: 0.48, v: 104, w: 282 }],
    mode: 'single',
    words: torrentWords(D),
    stroke: () => 'rgba(100,116,139,.6)',
    meta: () => '#2563eb',
    ready: () => heroReady,
  }, RM);

  /* ---------- phone bar ---------- */
  const mbar = $('#mbar'), hc = $('.hero .ctas');
  const mv = new Map<Element, boolean>();
  const mio = S.observe((es) => {
    es.forEach((e) => mv.set(e.target, e.isIntersecting));
    mbar.classList.toggle('away', [...mv.values()].some(Boolean));
  });
  [hc, $('.final'), opts.footer].filter((x): x is HTMLElement => !!x).forEach((e) => mio.observe(e));

  const hnum = $('#hnum');
  function heroCount() { if (!RM) countUp(S, hnum, 1300, 4); }

  wireLinks(S, root, opts.navigate, RM);

  /* ---------- boot ---------- */
  renderMail(false);
  renderLive();
  renderReqs(true);
  torrent.size();
  torrent.draw(0);
  heroCount();
  pinOn = null;
  applyLayout();
  if (RM) pbox.classList.add('run');
  [...$$('.rv'), pbox, tickL, mailEl, reqsEl, scr, liveWrap, numsEl].forEach((e) => io.observe(e));
  S.timeout(() => { heroReady = true; torrent.loop(); }, 1500);
  S.timeout(() => {
    root.classList.add('done');
    if (hnum.dataset.counting !== '1') hnum.textContent = fmt(+(hnum.dataset.n || 0));
  }, 2000);
  S.timeout(() => $$('.rv').forEach((e) => e.classList.add('in')), 5000);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (!S.alive) return;
      torrent.size(); torrent.draw(0);
      if (pinOn) layoutPin();
      sizeScan();
    });
  }

  return {
    update(next: StoryData) {
      D = { ...D, stats: next.stats, asOf: next.asOf };
      applyStats(root, D);
      torrent.setWords(torrentWords(next));
    },
    dispose() {
      S.dispose();
      root.classList.remove('pin');
    },
  };
}
