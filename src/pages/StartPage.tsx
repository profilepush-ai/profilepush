import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Logo from '../components/Logo';
import LiveMatches from '../components/landing/LiveMatches';
import { PushDemo, SendDemo, SheetDemo } from '../components/brand/FeatureDemos';
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
