import { useState } from 'react';
import { Briefcase, UserRound } from 'lucide-react';
import Logo from './Logo';
import LogoSpinner from './LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

type Persona = 'vendor' | 'bench_sales';

const OPTIONS: Array<{ id: Persona; icon: typeof Briefcase; title: string; description: string }> = [
  {
    id: 'vendor',
    icon: Briefcase,
    title: 'Vendor',
    description: 'I post Job requirements and request resumes off Hotlist listings.',
  },
  {
    id: 'bench_sales',
    icon: UserRound,
    title: 'Bench Sales',
    description: 'I post my Hotlist of consultants and apply to Jobs on their behalf.',
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
    <div className="flex min-h-screen items-center justify-center bg-[#f3f2ee] px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-8 flex justify-center">
          <Logo size="lg" />
        </div>
        <h1 className="mb-2 text-center text-xl font-bold text-gray-900">Which one are you?</h1>
        <p className="mb-8 text-center text-[13px] text-gray-500">
          This decides what you'll see across the app. You can switch anytime from the header.
        </p>

        <div className="space-y-3">
          {OPTIONS.map((option) => {
            const isSubmitting = submittingId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => void choose(option.id)}
                disabled={submittingId != null}
                className="flex w-full items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-blue-600 hover:shadow-sm disabled:opacity-60"
              >
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  {isSubmitting ? <LogoSpinner size={18} /> : <option.icon size={20} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-bold text-gray-900">{option.title}</span>
                  <span className="block text-[12px] text-gray-500">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>

        {error && <p className="mt-4 text-center text-[12px] text-red-500">{error}</p>}
      </div>
    </div>
  );
}
