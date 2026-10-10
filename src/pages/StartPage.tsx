import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Mail, Send } from 'lucide-react';
import Logo from '../components/Logo';
import LiveMatches from '../components/landing/LiveMatches';
import { FitLine } from '../components/match/Visuals';
import { trackEvent } from '../lib/track';
import { INTRO_SEEN_KEY } from '../lib/prefs';

// Before signing up (the app's first launch): four slides, mostly pictures.
// Swipe or tap through; Get started goes to signup and isn't shown again.

const FOR = ['Job Hunting', 'Job Posting', 'Bench Sales'];

function Rotating() {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % FOR.length), 2400); return () => clearInterval(t); }, []);
  return (
    <span className="block h-[1.15em] overflow-hidden">
      <span key={i} className="block animate-[ppWordIn_.8s_cubic-bezier(.2,.8,.2,1)]"><span className="text-[#2563EB]">{FOR[i]}</span><span className="text-[#F97316]">.</span></span>
    </span>
  );
}

// Slide 2: a match card that gets pushed off and comes back, over and over.
function PushDemo() {
  const pics = ['/landing-v2/java.webp', '/landing-v2/data.webp', '/landing-v2/cloud.webp'];
  const titles = ['Senior Java Developer', 'Data Engineer', 'Cloud DevOps Engineer'];
  const [n, setN] = useState(0);
  useEffect(() => { const t = setInterval(() => setN((x) => x + 1), 2200); return () => clearInterval(t); }, []);
  const k = n % 3;
  return (
    <div className="relative h-[330px] w-[250px] overflow-hidden rounded-[26px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.18)] ring-1 ring-black/5">
      <div key={n} className="absolute inset-0" style={{ animation: n ? 'ppPushInL 420ms cubic-bezier(.25,.8,.25,1) both' : undefined }}>
        <img src={pics[k]} alt="" className="h-[210px] w-full object-cover object-[50%_20%]" style={{ maskImage: 'linear-gradient(180deg,#000 70%,transparent)', WebkitMaskImage: 'linear-gradient(180deg,#000 70%,transparent)' }} />
        <div className="space-y-2 px-3.5 pb-3.5">
          <b className="block text-[17px] font-extrabold leading-tight">{titles[k]}</b>
          <FitLine value={[92, 88, 86][k]} />
          <div className="flex gap-1.5 text-[11px] font-bold">{['Java', 'AWS', 'SQL'].map((s) => <span key={s} className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-emerald-500 px-2 py-[1px]"><Check size={10} strokeWidth={3} />{s}</span>)}</div>
        </div>
      </div>
      {n > 0 && (
        <div key={`s${n}`} aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ animation: 'ppSeamL 420ms cubic-bezier(.25,.8,.25,1) both' }}>
          <svg width="80" height="46" viewBox="0 0 112 64" fill="none" className="absolute left-[-6px] top-1/2" style={{ transform: 'translateY(-50%) scaleX(-1)' }}>
            <polyline points="26,12 46,32 26,52" stroke="#2563EB" strokeOpacity=".45" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="62" cy="21" r="7.5" fill="#FACC15" /><circle cx="62" cy="43" r="7.5" fill="#F97316" />
            <polyline points="78,8 102,32 78,56" stroke="#2563EB" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
    </div>
  );
}

// Slide 3: the Send resume sheet, the email writing itself.
function SendDemo() {
  return (
    <div className="w-[270px] space-y-2.5 rounded-[24px] bg-white p-3.5 text-left shadow-[0_24px_60px_rgba(11,26,58,.18)] ring-1 ring-black/5">
      {[['Ravi_K_Java.pdf', true, 'PDF'], ['Ravi_K_AWS.docx', false, 'DOC']].map(([f, on, t]) => (
        <div key={f as string} className={`flex items-center gap-2 rounded-xl border-[1.5px] px-2.5 py-2 ${on ? 'border-blue-600 bg-blue-50/60' : 'border-gray-200'}`}>
          <span className={`grid h-4 w-4 place-items-center rounded-full ${on ? 'bg-blue-600 text-white' : 'ring-[1.5px] ring-gray-300'}`}>{on && <Check size={10} strokeWidth={4} />}</span>
          <span className={`grid h-6 w-6 place-items-center rounded-md text-[8px] font-extrabold ${t === 'PDF' ? 'bg-red-50 text-red-600' : 'bg-blue-100 text-blue-700'}`}>{t as string}</span>
          <span className="truncate text-[12.5px] font-semibold">{f as string}</span>
        </div>
      ))}
      <div className="space-y-1.5 rounded-xl border border-gray-200 p-2.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold text-gray-500"><Mail size={12} />AI is writing the email</p>
        {[96, 100, 82, 64].map((w, i) => <i key={w} className="block h-2 origin-left rounded-full bg-gray-200" style={{ width: `${w}%`, animation: `ppTypeLine 2.4s ease-out ${i * 0.25}s infinite` }} />)}
      </div>
      <span className="flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 text-[13.5px] font-bold text-white"><Send size={15} />Send resume</span>
    </div>
  );
}

// Slide 4: the tracker as a sheet.
function SheetDemo() {
  const rows: Array<[string, string, string]> = [['Senior Java Developer', 'Interview', '#7c3aed'], ['Data Engineer', 'Replied', '#2563eb'], ['Cloud DevOps Engineer', 'Placed', '#059669'], ['React Developer', 'Applied', '#94a3b8'], ['SAP FICO Consultant', 'Replied', '#2563eb']];
  return (
    <div className="w-[290px] overflow-hidden rounded-[18px] bg-white text-left shadow-[0_24px_60px_rgba(11,26,58,.18)] ring-1 ring-black/5">
      <div className="grid grid-cols-[1fr_auto] border-b border-gray-200 bg-[#f8f9fa] px-3 py-2 text-[11px] font-bold text-gray-500"><span>Job</span><span>Status</span></div>
      {rows.map(([t, s, c], i) => (
        <div key={t} className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-gray-100 px-3 py-2.5 text-[12.5px]" style={{ animation: `ppFadeUp .4s ease-out ${i * 0.08}s both` }}>
          <b className="truncate font-semibold text-blue-700">{t}</b>
          <span className="inline-flex items-center gap-1.5 font-bold text-gray-700"><i className="h-2 w-2 rounded-full" style={{ background: c }} />{s}</span>
        </div>
      ))}
    </div>
  );
}

const SLIDES: Array<{ visual: ReactNode; title: ReactNode; text: string }> = [
  // The live deck is 330×560; shown at 0.74 in a box of its scaled size.
  { visual: <div className="h-[414px] w-[244px] shrink-0"><div className="w-[330px] origin-top-left scale-[.74]"><LiveMatches /></div></div>, title: <>AI Copilot for<Rotating /></>, text: 'Live matches for your profile, your consultants or your jobs, every day.' },
  { visual: <PushDemo />, title: <>Swipe. Push. Apply.</>, text: 'Every match has its score, the skills that fit and an AI picture. Apply in one tap.' },
  { visual: <SendDemo />, title: <>Send the resume. AI writes the email.</>, text: 'Pick a resume or upload one. It goes from your own Gmail.' },
  { visual: <SheetDemo />, title: <>Every application in one sheet.</>, text: 'Replies, interviews and placements, tracked for you.' },
];

export default function StartPage() {
  const navigate = useNavigate();
  const [at, setAt] = useState(0);
  const start = useRef<number | null>(null);
  const last = at === SLIDES.length - 1;
  const done = (to: '/signup' | '/signin', where: string) => {
    try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* fine */ }
    trackEvent('intro_done', { where, slide: at + 1 });
    navigate(to);
  };
  const go = (d: number) => setAt((x) => Math.max(0, Math.min(SLIDES.length - 1, x + d)));

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-[#F8FAFC] pt-[env(safe-area-inset-top)] text-[#0B1A3A]"
      onPointerDown={(e) => { start.current = e.clientX; }}
      onPointerUp={(e) => { const s = start.current; start.current = null; if (s == null) return; const dx = e.clientX - s; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); }}
      style={{ touchAction: 'pan-y' }}>
      <div aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-[380px] w-[380px] rounded-full bg-[#2563EB]/12 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -left-28 bottom-40 h-[300px] w-[300px] rounded-full bg-[#FACC15]/15 blur-3xl" />
      <div className="relative flex items-center justify-between px-5 py-3">
        <Logo size="md" />
        {!last && <button type="button" onClick={() => done('/signup', 'skip')} className="rounded-full px-3 py-1.5 text-[14px] font-semibold text-gray-500">Skip</button>}
      </div>

      {/* The slides, side by side, moved together. */}
      <div className="relative min-h-0 flex-1">
        <div className="flex h-full transition-transform duration-500 ease-[cubic-bezier(.25,.8,.25,1)]" style={{ transform: `translateX(-${at * 100}%)` }}>
          {SLIDES.map((s, i) => (
            <section key={i} aria-hidden={i !== at} className="flex h-full w-full shrink-0 flex-col items-center px-6">
              <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden pt-2">{i === at || Math.abs(i - at) === 1 ? s.visual : null}</div>
              <div className="w-full max-w-sm pb-2 pt-4">
                <h1 className="text-balance text-[30px] font-extrabold leading-[1.08] tracking-[-0.02em]">{s.title}</h1>
                <p className="mt-2.5 text-[15.5px] leading-relaxed text-gray-600">{s.text}</p>
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="relative mx-auto w-full max-w-sm space-y-3 px-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">
        <div className="flex justify-center gap-1.5" role="tablist" aria-label="Slides">
          {SLIDES.map((_, i) => (
            <button key={i} type="button" role="tab" aria-selected={i === at} aria-label={`Slide ${i + 1}`} onClick={() => setAt(i)}
              className={`h-2 rounded-full transition-all ${i === at ? 'w-6 bg-[#2563EB]' : 'w-2 bg-gray-300'}`} />
          ))}
        </div>
        <button type="button" onClick={() => (last ? done('/signup', 'get_started') : go(1))}
          className="flex h-[52px] w-full items-center justify-center gap-2 rounded-2xl bg-[#2563EB] text-[16px] font-bold text-white shadow-[0_10px_28px_rgba(37,99,235,.35)]">
          {last ? 'Get started: 100 free matches' : 'Next'}<ArrowRight size={18} />
        </button>
        <p className="text-center text-[14px] text-gray-500">
          Have an account? <Link to="/signin" onClick={() => { try { localStorage.setItem(INTRO_SEEN_KEY, '1'); } catch { /* fine */ } }} className="font-bold text-[#2563EB]">Sign in</Link>
        </p>
        <p className="text-center text-[12px] text-gray-400">No card needed</p>
      </div>
    </div>
  );
}
