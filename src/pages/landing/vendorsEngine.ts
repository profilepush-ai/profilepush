// /vendors engine: hero torrent of the real hotlist, the self-filling
// requirement, the pinned scroll-driven sort on desktop, the phone tickers with
// the vertical pull, the AI Request email, the live Tracker column, the
// screening card, count-ups and the phone bar. Ported from
// website-demos/profilepush-ai/vendors.

import {
  Scope, Torrent, applyStats, cardMakers, clamp, countUp, ease, esc, fmt, htmlEl, jobSub, lerp, makeAgo,
  map, newestAt, okLoc, okWork, queries, reducedMotion, reflow, rng, tc, wireLinks, workLabel,
} from './engine';
import type { EngineOptions, PageEngine, SnapCon, StoryData } from './engine';


interface FloodCard {
  el: HTMLElement; i: number; m: { ci: number; k: number } | null;
  s0: number; w: number; x0: number; y0: number; r0: number; dir: number; b0: number; o0: number; fall: number; tx: number; ty: number;
}

export function startVendors(root: HTMLElement, data: StoryData, opts: EngineOptions): PageEngine {
  const S = new Scope();
  const RM = reducedMotion();
  const { $, $$ } = queries(root);
  let D = data;
  const ago = makeAgo(newestAt(D));
  const { conCard } = cardMakers(ago);

  /* vendor side: real snapshot items. Columns are real requirements; the flood is the real hotlist. */
  const M = {
    flood: D.hotlist,
    card: conCard,
    cols: [{ h: D.jobs[14], m: [21, 9, 37] }, { h: D.jobs[4], m: [0, 11, 23] }, { h: D.jobs[0], m: [15, 24, 10] }],
  };
  const NW = '<span class="tag nw">New</span>';
  function colHTML(ci: number, newN: number, body: string, reqN?: number) {
    const c = M.cols[ci];
    return `<div class="col c${ci}"><div class="col-h"><div class="h"><span class="dot o"></span>${esc(c.h.t)}</div><p>${esc(jobSub(c.h))}</p>
  <div class="pills"><span class="pill">New <b data-new>${newN}</b></span><span class="pill mu">Requested <b data-rq>${reqN || 0}</b></span></div></div>
  <div class="col-b"><div class="slots">${body}</div></div></div>`;
  }
  const nFit = M.cols.reduce((a, c) => a + c.m.length, 0);
  function texts() {
    $$('[data-t=c0]').forEach((e) => (e.textContent = `${fmt(D.stats.hot24h)} consultants hit hotlists in the last 24 hours. Here are 40 real ones from today.`));
    $$('[data-t=c2m]').forEach((e) => (e.textContent = nFit + ' of 40 fit. Each lands in its column.'));
    $$('[data-t=c2]').forEach((e) => (e.textContent = `${nFit} of 40 fit. Each pushed into its requirement’s column, marked New.`));
  }

  /* ---------- 1. PASTE -> STRUCTURED REQUIREMENT ---------- */
  const PJ = D.jobs[14];
  const pasteText = `Need: ${PJ.t}\nLocation: ${PJ.loc}\nType: ${PJ.type}\nExperience: ${PJ.exp} years\nMust have: ${PJ.skills.join(', ')}`;
  const reqCard = $('#reqCard');
  reqCard.innerHTML = `<div class="col-h"><div class="h"><span class="dot o"></span>${esc(PJ.t)}</div><p>${esc(jobSub(PJ))}</p>
 <div class="pills"><span class="pill">New <b>0</b></span><span class="pill mu">Requested <b>0</b></span></div></div>
 <div class="col-b">
    <div class="fld fr"><span class="k">Role</span><span class="v">${esc(PJ.t)}</span></div>
  <div class="fld"><span class="k">Skills</span><span class="v">${PJ.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</span></div>
  <div class="fld"><span class="k">Experience</span><span class="v">${PJ.exp} yrs</span></div>
  <div class="fld"><span class="k">Type</span><span class="v">${esc(PJ.type)}</span></div>
  <div class="fld"><span class="k">Location</span><span class="v">${esc(PJ.loc)}</span></div>
 </div>`;
  let parseSeen = false, parseT = 0;
  function runParse(type: boolean) {
    const t = $('#pasteT'), ch = $('#bigchev');
    S.clearTimeout(parseT);
    if (!type || RM) { t.textContent = pasteText; if (RM) reqCard.classList.add('run'); return; }
    reqCard.classList.remove('run');
    ch.classList.remove('go');
    t.textContent = '';
    const tn = document.createTextNode('');
    const car = document.createElement('span');
    car.className = 'caret';
    t.append(tn, car);
    let i = 0;
    const step = () => {
      i += 3;
      tn.data = pasteText.slice(0, i);
      if (i < pasteText.length) parseT = S.timeout(step, 28);
      else parseT = S.timeout(() => { car.remove(); ch.classList.add('go'); S.timeout(() => reqCard.classList.add('run'), 380); }, 300);
    };
    parseT = S.timeout(step, 300);
  }

  /* ---------- PINNED (desktop) ---------- */
  const pinEl = $('#fxPin'), board = $('#board');
  let cards: FloodCard[] = [], cols: HTMLElement[] = [], boardW = 0, boardH = 0, sweepEl: HTMLElement | null = null, pinOn = false, lastP = -1;
  const caps = $$('.cap'), fitEl = $('#fxFit');
  function buildPin() {
    const colsHTML = M.cols.map((c, ci) => colHTML(ci, 0, c.m.map((_, k) => `<div class="slot" data-c="${ci}" data-k="${k}"></div>`).join(''))).join('');
    board.innerHTML = `<div class="cols">${colsHTML}</div><div class="field"></div><div class="sweep"><svg viewBox="0 0 150 600" preserveAspectRatio="none"><defs><linearGradient id="sg" x1="0" x2="1"><stop offset="0" stop-color="#2563eb" stop-opacity="0"/><stop offset="1" stop-color="#2563eb" stop-opacity=".35"/></linearGradient></defs><path d="M0 0 L110 300 L0 600 Z" fill="url(#sg)"/><path d="M40 6 L136 300 L40 594" fill="none" stroke="#2563eb" stroke-width="10" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg></div>`;
    sweepEl = $<HTMLElement>('.sweep', board);
    cols = $$('.col', board);
    const field = $('.field', board);
    const matchOf: Record<number, { ci: number; k: number }> = {};
    M.cols.forEach((c, ci) => c.m.forEach((idx, k) => (matchOf[idx] = { ci, k })));
    cards = M.flood.map((item, i) => {
      const el = document.createElement('div');
      el.className = 'fc';
      el.innerHTML = M.card(item, false, matchOf[i] ? NW : '');
      field.appendChild(el);
      return { el, i, m: matchOf[i] || null, s0: 0, w: 0, x0: 0, y0: 0, r0: 0, dir: 1, b0: 0, o0: 0, fall: 0, tx: 0, ty: 0 };
    });
    $('#fxAll').textContent = String(M.flood.length);
    layoutPin();
  }
  function layoutPin() {
    if (!cards.length) return;
    const br = board.getBoundingClientRect();
    boardW = br.width; boardH = br.height;
    cols.forEach((c) => (c.style.transform = 'none'));
    const slots = $$('.slot', board);
    const cw = slots[0].getBoundingClientRect().width;
    const R = rng(10);
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
        if (k > 0.6) fits++;
        c.el.classList.toggle('hit', k > 0.6 && g < 0.98);
        const tcEl = c.el.firstElementChild;
        if (tcEl) tcEl.classList.toggle('new', g >= 0.98);
        x = lerp(x, c.tx, g); y = lerp(y, c.ty, g); sc = lerp(sc, 1, g); rot = lerp(rot, 0, g);
      }
      c.el.style.transform = `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0) rotate(${rot.toFixed(2)}deg) scale(${sc.toFixed(4)})`;
      c.el.style.opacity = o.toFixed(3);
      c.el.style.filter = b > 0.05 ? `blur(${b.toFixed(1)}px)` : 'none';
      c.el.style.zIndex = c.m ? '2' : '1';
    }
    fitEl.textContent = String(fits);
    const ch = map(p, 0.46, 0.62);
    cols.forEach((col, i) => {
      col.style.opacity = String(ch);
      col.style.transform = `translateY(${(1 - ch) * 24}px)`;
      const n = String(Math.round(map(p, 0.78 + i * 0.02, 0.86 + i * 0.02) * M.cols[i].m.length));
      const e = $('[data-new]', col);
      if (e.textContent !== n) e.textContent = n;
    });
  }
  let raf = 0;
  S.on(window, 'scroll', () => {
    if (pinOn && !raf) raf = S.raf(() => { raf = 0; updatePin(); });
  }, { passive: true });

  /* ---------- STACKED (phones, reduced motion): vertical ticker + vertical pull ---------- */
  const tk1 = $('#tk1'), tk2 = $('#tk2'), seg = $('#seg'), scol = $('#scol'), pchev = $('#pullchev');
  let tabI = 0;
  const SHORT = ['Java Full Stack', 'Azure Data', 'Cloud Architect'];
  const rowMeta = (c: SnapCon) => {
    const m = [okLoc(c.loc) ? c.loc : okWork(c.work) ? workLabel(c.work) : '', c.visa, c.exp ? c.exp + ' yrs' : ''].filter(Boolean);
    return m.length ? m.join(' · ') : ago(c.at).replace('Posted ', '');
  };
  const rowHTML = (c: SnapCon) => `<i></i><b>${esc(tc(c.t))}</b><span>${esc(rowMeta(c))}</span>`;
  const RH = 48;
  interface Row { el: HTMLElement; slot: number; it: { i: number; m: boolean }; gone?: boolean }
  class Ticker {
    rows: Row[] = [];
    t = 0;
    vis = false;
    k = 0;
    seq: Array<{ i: number; m?: boolean }> = [];
    constructor(public el: HTMLElement, public n: number, public ms: number, public onPull: ((i: number) => void) | null = null) {}
    reset(seq: Array<{ i: number; m?: boolean }>) {
      this.seq = seq; this.k = 0; this.el.innerHTML = ''; this.rows = [];
      // fill visible slots, oldest at bottom
      for (let s = this.n - 1; s >= 0; s--) {
        const it = this.next();
        const o = this.add(it, s);
        if (it.m && s >= this.n - 2) o.el.classList.add('fit');
      }
    }
    next() { const it = this.seq[this.k % this.seq.length]; this.k++; return { i: it.i, m: !!it.m }; }
    add(it: { i: number; m: boolean }, slot: number): Row {
      const r = document.createElement('div');
      r.className = 'tr' + (it.m ? ' mt' : '');
      r.innerHTML = rowHTML(M.flood[it.i]);
      r.style.transform = `translateY(${12 + slot * RH}px)`;
      this.el.prepend(r);
      const o: Row = { el: r, slot, it };
      this.rows.push(o);
      return o;
    }
    step() {
      const o = this.add(this.next(), -1);
      o.el.style.opacity = '0';
      reflow(o.el);
      o.el.style.opacity = '';
      for (const r of this.rows) {
        r.slot++;
        r.el.style.transform = `translateY(${12 + r.slot * RH}px)`;
        if (r.it.m && r.slot >= this.n - 2) r.el.classList.add('fit');
        if (r.slot >= this.n && !r.gone) {
          r.gone = true;
          r.el.style.opacity = '0';
          if (r.it.m && this.onPull) this.onPull(r.it.i);
          S.timeout(() => r.el.remove(), 500);
        }
      }
      this.rows = this.rows.filter((r) => !r.gone);
    }
    run() {
      S.clearInterval(this.t); this.t = 0;
      if (!RM && this.vis && !document.hidden) this.t = S.interval(() => this.step(), this.ms);
    }
  }
  const all = M.flood.map((_, i) => i);
  const T1 = new Ticker(tk1, 8, 520);
  const T2 = new Ticker(tk2, 4, 650, (i) => pull(i));
  function seq2() {
    const m = M.cols[tabI].m, noise = all.filter((i) => !M.cols.some((c) => c.m.includes(i)));
    const q: Array<{ i: number; m?: boolean }> = [];
    let a = 0;
    const N = () => q.push({ i: noise[a++ % noise.length] });
    // first match already near the bottom of the ticker, then one every few rows
    N(); q.push({ i: m[2], m: true }); N(); N(); N(); q.push({ i: m[0], m: true }); N(); N(); N(); q.push({ i: m[1], m: true }); N(); N(); N();
    return q;
  }
  function mkCard(i: number) { const el = htmlEl(M.card(M.flood[i], true, NW)); el.dataset.i = String(i); return el; }
  function pull(i: number) {
    const sl = $('.slots', scol);
    if (!sl) return;
    pchev.classList.remove('go'); reflow(pchev); pchev.classList.add('go');
    const old = sl.querySelector(`.tc[data-i="${i}"]`);
    if (old) old.remove();
    const el = mkCard(i);
    el.classList.add('enter');
    const ps = $('.pslot', sl);
    if (ps) ps.after(el); else sl.prepend(el);
    const cs = sl.querySelectorAll('.tc');
    if (cs.length > 3) cs[cs.length - 1].remove();
    $('[data-new]', scol).textContent = String(sl.querySelectorAll('.tc').length);
  }
  function buildStack() {
    T1.reset(all.map((i) => ({ i })));
    seg.innerHTML = M.cols.map((_, i) => `<button type="button" role="tab" aria-selected="${i === tabI}" data-i="${i}">${SHORT[i]}</button>`).join('');
    renderScol();
  }
  function renderScol() {
    const c = M.cols[tabI];
    if (RM) {
      scol.innerHTML = colHTML(tabI, c.m.length, c.m.map((i) => M.card(M.flood[i], true, NW)).join(''));
      T2.reset(seq2().filter((x) => !x.m));
      return;
    }
    scol.innerHTML = colHTML(tabI, 2, '<div class="pslot">Next fit lands here</div>');
    const sl = $('.slots', scol);
    sl.append(mkCard(c.m[1]), mkCard(c.m[0]));
    T2.reset(seq2());
    T2.run();
  }
  S.on(seg, 'click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('button');
    if (!b) return;
    tabI = +(b.dataset.i as string);
    $$('button', seg).forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    renderScol();
  });
  const tio = S.observe((es) => es.forEach((e) => {
    const T = e.target === tk1 ? T1 : T2;
    T.vis = e.isIntersecting;
    T.run();
  }), { threshold: 0.2 });
  tio.observe(tk1);
  tio.observe(tk2);
  S.on(document, 'visibilitychange', () => { T1.run(); T2.run(); });

  /* ---------- 5. AI REQUEST EMAIL ---------- */
  let typeTimer = 0, mailSeen = false;
  const MJ = D.jobs[14], MC = D.hotlist[21], MCT = tc(MC.t);
  const mailBody = `Hi,\n\nI have a ${MJ.t} requirement (${MJ.loc}, ${MJ.type}) that fits your ${MCT} consultant.\n\nCould you share their resume, rate, visa status and availability?`;
  $('#mTo').textContent = 'The bench recruiter for this consultant';
  $('#mSub').textContent = `${MCT}: resume and rate?`;
  $('#mExtra').innerHTML = '<div class="chk"><span class="cb" aria-hidden="true"></span>Include a video screening link (optional)</div>';
  $('#pair').innerHTML = [[jobSub(MJ), MJ.t + ' · your requirement', ' o'], [MC.exp + ' yrs · ' + MC.visa + ' · Open to relocate', MCT, '']]
    .map((p) => `<div class="mini"><span class="dot${p[2]}"></span><div><b>${esc(p[1])}</b><span>${esc(p[0])}</span></div></div>`).join('');
  function renderMail(type: boolean) {
    const body = $('#mBody');
    S.clearTimeout(typeTimer);
    $('#pushrow').classList.remove('go');
    if (!type || RM) { body.textContent = mailBody; return; }
    body.textContent = '';
    const tn = document.createTextNode('');
    const car = document.createElement('span');
    car.className = 'caret';
    body.append(tn, car);
    let i = 0;
    const step = () => {
      i += 2;
      tn.data = mailBody.slice(0, i);
      if (i < mailBody.length) typeTimer = S.timeout(step, 32);
      else S.timeout(() => { car.remove(); $('#pushrow').classList.add('go'); }, 600);
    };
    typeTimer = S.timeout(step, 350);
  }

  /* ---------- 6. LIVE TRACKER ---------- */
  const liveCol = $('#liveCol'), toast = $('#toast');
  let liveT = 0, liveStep = 0, liveVis = false, liveStarted = false;
  const POOL = [21, 9, 37, 7, 35];
  function renderLive() {
    liveCol.innerHTML = colHTML(0, 3, POOL.slice(0, 3).map((i) => M.card(M.flood[i], true)).join(''));
    liveStep = 0;
    if (RM) {
      $('.slots', liveCol).innerHTML = POOL.slice(0, 4).map((i) => M.card(M.flood[i], true)).join('');
      $('[data-new]', liveCol).textContent = '4';
    }
  }
  function retag(el: Element, html: string) {
    el.querySelector('.tag.nw')?.remove();
    $('.tc-h', el).insertAdjacentHTML('beforeend', html);
  }
  function liveTick() {
    const sl = $('.slots', liveCol), nEl = $('[data-new]', liveCol), rq = $('[data-rq]', liveCol);
    if (!sl) return;
    const add = (idx: number) => {
      const el = htmlEl(M.card(M.flood[idx], true, NW));
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
      const el = sl.children[1] as HTMLElement;
      retag(el, '<span class="tag rq">Requested</span>');
      el.style.borderColor = '#2563eb';
      rq.textContent = '1';
    } else if (liveStep === 4) {
      const el = sl.children[sl.children.length - 1] as HTMLElement;
      retag(el, '<span class="tag mg">Repost merged</span>');
      el.style.borderColor = '#8b5cf6';
    } else if (liveStep === 5) {
      const el = sl.children[0] as HTMLElement;
      retag(el, '<span class="tag nm">Not a match</span>');
      S.timeout(() => {
        el.classList.add('gone');
        S.timeout(() => { el.remove(); nEl.textContent = String(sl.children.length); }, 500);
      }, 900);
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

  /* ---------- 7. SCREENING CARD ---------- */
  const SC = D.hotlist[9], scard = $('#scard');
  $('#scT').textContent = tc(SC.t);
  $('#scS').textContent = [SC.exp ? SC.exp + ' yrs' : '', okWork(SC.work) ? SC.work : '', 'Consultant'].filter(Boolean).join(' · ');
  (function wave() {
    const R = rng(5);
    let h = '';
    for (let i = 0; i < 40; i++) {
      const v = 0.25 + 0.75 * Math.abs(Math.sin(i * 0.55)) * (0.45 + R() * 0.55);
      h += `<i style="--h:${Math.round(v * 40)}px;--d:-${(R() * 1.1).toFixed(2)}s"></i>`;
    }
    $('#wave').innerHTML = h;
  })();
  let scSeen = false;
  if (RM) scard.classList.add('run');

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
      applyLayout();
      if (!pinOn && wc) buildStack();
    }, 150);
  });

  /* ---------- observers ---------- */
  const pasteEl = $('#paste'), mailEl = $('#mail'), liveWrap = $('#liveWrap'), numsEl = $('#nums');
  const io = S.observe((es) => es.forEach((e) => {
    const t = e.target as HTMLElement;
    if (t.classList.contains('rv') && e.isIntersecting) { t.classList.add('in'); if (t !== scard) io.unobserve(t); }
    if (t === pasteEl && e.isIntersecting && !parseSeen) { parseSeen = true; runParse(true); }
    if (t === mailEl && e.isIntersecting && !mailSeen) { mailSeen = true; renderMail(true); }
    if (t === scard) {
      if (e.isIntersecting && !scSeen) { scSeen = true; scard.classList.remove('run'); reflow(scard); scard.classList.add('run'); }
      scard.classList.toggle('inview', e.isIntersecting && !document.hidden);
    }
    if (t === liveWrap) {
      liveVis = e.isIntersecting;
      if (liveVis && !liveStarted) S.timeout(() => { liveStarted = true; liveRun(); }, 1500);
      liveRun();
    }
    if (t === numsEl && e.isIntersecting) { if (!RM) $$('.n', numsEl).forEach((el) => countUp(S, el, 1400, 3)); io.unobserve(t); }
  }), { threshold: 0.35 });
  S.on(document, 'visibilitychange', () => { liveRun(); if (document.hidden) scard.classList.remove('inview'); });

  /* ---------- hero torrent (canvas): the real hotlist ---------- */
  const hero = $('.hero');
  let heroReady = false;
  const torrentWords = (d: StoryData) => d.hotlist.map((c) => ({
    t: tc(c.t),
    m: ['Consultant', c.visa, c.exp ? c.exp + ' yrs' : '', okWork(c.work) ? workLabel(c.work) : ''].filter(Boolean).join(' · '),
  }));
  const torrent = new Torrent(S, $<HTMLCanvasElement>('#torrent'), hero, {
    layers: [{ fs: 11, a: 0.22, v: 34, w: 190 }, { fs: 13, a: 0.34, v: 62, w: 228 }, { fs: 16, a: 0.48, v: 104, w: 282 }],
    mode: 'single',
    words: torrentWords(D),
    stroke: () => 'rgba(100,116,139,.55)',
    meta: () => '#a16207',
    ready: () => heroReady,
  }, RM);

  /* ---------- phone bar ---------- */
  const mbar = $('#mbar'), hc = $('.hero .ctas'), fin = $('.final');
  const bar = { hero: true, end: false };
  const barUp = () => mbar.classList.toggle('away', bar.hero || bar.end);
  S.observe((es) => {
    es.forEach((e) => {
      if (e.target === hc) bar.hero = e.isIntersecting || e.boundingClientRect.top > 0;
      else bar.end = e.isIntersecting || e.boundingClientRect.top < 0;
    });
    barUp();
  }).observe(hc);
  const endObs = S.observe((es) => {
    es.forEach((e) => { bar.end = e.isIntersecting || e.boundingClientRect.top < 0; });
    barUp();
  }, { rootMargin: '0px 0px -10% 0px' });
  endObs.observe(fin);

  /* ---------- hero count ---------- */
  const hnum = $('#hnum');
  function heroCount() { if (!RM) countUp(S, hnum, 1300, 4); }

  wireLinks(S, root, opts.navigate, RM);

  /* ---------- boot ---------- */
  texts();
  renderMail(false);
  renderLive();
  runParse(false);
  torrent.size();
  torrent.draw(0);
  heroCount();
  applyLayout();
  if (!pinOn) buildStack();
  [...$$('.rv'), mailEl, pasteEl, liveWrap, numsEl].forEach((e) => io.observe(e));
  S.timeout(() => { heroReady = true; torrent.loop(); }, 1500);
  S.timeout(() => {
    root.classList.add('done');
    if (hnum.dataset.counting !== '1') hnum.textContent = fmt(+(hnum.dataset.n || 0));
  }, 2000);
  S.timeout(() => { $$('.rv').forEach((e) => e.classList.add('in')); reqCard.classList.add('run'); scard.classList.add('run'); }, 5000);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      if (!S.alive) return;
      torrent.size(); torrent.draw(0);
      if (pinOn) layoutPin(); else buildStack();
    });
  }

  return {
    update(next: StoryData) {
      D = { ...D, stats: next.stats, asOf: next.asOf };
      applyStats(root, D);
      texts();
      torrent.setWords(torrentWords(next));
    },
    dispose() {
      S.dispose();
      root.classList.remove('pin');
    },
  };
}
