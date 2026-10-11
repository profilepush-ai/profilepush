import { useState } from 'react';
import { Briefcase, ChevronRight, Search, UserRound } from 'lucide-react';
import Logo from './Logo';
import LogoSpinner from './LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

// job_seeker works the profile side like bench sales (accounts.job_seeker).
type Persona = 'job_seeker' | 'bench_sales' | 'vendor';

const OPTIONS: Array<{ id: Persona; icon: typeof Briefcase; title: string; description: string; picture: string }> = [
  {
    id: 'job_seeker',
    icon: Search,
    title: 'Job seeker',
    description: "I'm looking for a job. Add my profile and get matched to jobs every day.",
    picture: '/landing-v2/java.webp',
  },
  {
    id: 'bench_sales',
    icon: UserRound,
    title: 'Recruiter (bench sales)',
    description: 'I market profiles and apply to jobs for them.',
    picture: '/landing-v2/data.webp',
  },
  {
    id: 'vendor',
    icon: Briefcase,
    title: 'Job poster (vendor)',
    description: 'I post jobs, get matched profiles and ask for resumes.',
    picture: '/landing-v2/cloud.webp',
  },
];

// Full-screen, non-dismissable — no close button, no ESC/skip path. Shown by
// ProtectedRoute whenever the signed-in account's active_persona is null,
// which covers both a brand-new signup and any pre-existing account that
// never answered this. Picking an option persists it immediately via
// set_active_persona, then refreshAccount() lets ProtectedRoute naturally
// render the real app once account.active_persona is no longer null.
export default function PersonaGateScreen() {
  const { refreshAccount } = useAuth();
  const [submittingId, setSubmittingId] = useState<Persona | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(persona: Persona) {
    if (submittingId) return;
    setSubmittingId(persona);
    setError(null);
    try {
      const { error: rpcError } = await supabase.rpc('set_active_persona' as never, { p_persona: persona } as never);
      if (rpcError) throw rpcError;
      await refreshAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your selection — please try again.');
      setSubmittingId(null);
    }
  }

  return (
    <div className="relative flex min-h-[100dvh] flex-col overflow-hidden bg-[#F8FAFC] px-5 pb-[calc(1.5rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] sm:items-center sm:justify-center">
      <div aria-hidden="true" className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full bg-[#2563EB]/12 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 bottom-24 h-64 w-64 rounded-full bg-[#FACC15]/15 blur-3xl" />
      <div className="relative w-full max-w-lg">
        <Logo size="md" />
        <h1 className="mt-8 text-[30px] font-extrabold leading-[1.1] tracking-[-0.02em] text-[#0B1A3A]">What brings you here?</h1>
        <p className="mt-2 text-[15px] text-gray-600">We&apos;ll set up your matches for it. You can switch anytime.</p>

        <div className="mt-7 space-y-3">
          {OPTIONS.map((option, i) => {
            const isSubmitting = submittingId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => void choose(option.id)}
                disabled={submittingId != null}
                className={`flex w-full items-center gap-4 rounded-3xl border-[1.5px] bg-white p-3.5 text-left shadow-[0_6px_20px_rgba(11,26,58,.06)] transition active:scale-[.99] disabled:opacity-60 ${isSubmitting ? 'border-[#2563EB]' : 'border-transparent hover:border-[#2563EB]/50'}`}
                style={{ animation: `ppFadeUp .45s ease-out ${0.08 * i}s both` }}
              >
                <span className="relative shrink-0">
                  <img src={option.picture} alt="" className="h-16 w-16 rounded-2xl object-cover object-[50%_18%]" />
                  <span className="absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full bg-[#2563EB] text-white ring-[3px] ring-white">
                    {isSubmitting ? <LogoSpinner size={12} /> : <option.icon size={14} />}
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[16.5px] font-extrabold text-[#0B1A3A]">{option.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-gray-500">{option.description}</span>
                </span>
                <ChevronRight size={20} className="shrink-0 text-gray-300" />
              </button>
            );
          })}
        </div>

        {error && <p className="mt-4 text-center text-[12px] text-red-500">{error}</p>}
        <p className="mt-6 text-center text-[13px] font-semibold text-gray-500">100 free matches are waiting for you.</p>
      </div>
    </div>
  );
}
