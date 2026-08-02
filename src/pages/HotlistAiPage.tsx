import { useEffect, useMemo, useState } from 'react';
import { Briefcase, CalendarClock, CheckCircle2, Clock3, MapPin, Plus, RefreshCw, Search, Sparkles, Target, User, X } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import Toast from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { buildSupabaseFunctionHeaders, supabase } from '../lib/supabase';
import { HOTLIST_AI_SUGGESTIONS } from '../lib/hotlist-ai-suggestions';

interface HotlistRoleRow {
  id: string;
  account_id: string;
  target_role: string;
  category: string | null;
  years_exp: number | null;
  min_years_exp: number | null;
  max_years_exp: number | null;
  visa_status: string | null;
  employment_type: string | null;
  work_type: string | null;
  preferred_locations: string | null;
  min_rate_usd_per_hr: number | null;
  max_rate_usd_per_hr: number | null;
  relocation_open: boolean | null;
  priority_skills: string | null;
  schedule_frequency: 'disabled' | 'hourly' | 'daily' | 'twice_daily' | 'weekly';
  is_active: boolean;
  last_run_at: string | null;
  last_result_summary: string | null;
  created_at: string;
  updated_at: string;
}

interface HotlistMatchRow {
  id: string;
  profile_id: string;
  score: number;
  ai_notes: string | null;
  score_breakdown: Record<string, unknown> | null;
  created_at: string;
}

interface RoleFormState {
  target_role: string;
  min_years_exp: string;
  max_years_exp: string;
  visa_status: string;
  employment_type: string;
  work_type: string;
  preferred_locations: string;
  min_rate_usd_per_hr: string;
  max_rate_usd_per_hr: string;
  relocation_open: boolean;
  priority_skills: string;
  schedule_frequency: HotlistRoleRow['schedule_frequency'];
  is_active: boolean;
}

const EMPTY_FORM: RoleFormState = {
  target_role: '',
  min_years_exp: '',
  max_years_exp: '',
  visa_status: '',
  employment_type: '',
  work_type: '',
  preferred_locations: '',
  min_rate_usd_per_hr: '',
  max_rate_usd_per_hr: '',
  relocation_open: false,
  priority_skills: '',
  schedule_frequency: 'daily',
  is_active: true,
};

function formatSchedule(label: string) {
  return label === 'disabled' ? 'Disabled' : label === 'hourly' ? 'Hourly' : label === 'twice_daily' ? 'Twice daily' : label === 'weekly' ? 'Weekly' : 'Daily';
}

function inferRoleCategoryId(role: string, summary?: string | null) {
  const text = `${role} ${summary ?? ''}`.toLowerCase();
  if (/front\s*end|frontend|react|ui|angular|vue/.test(text)) return 'front-end';
  if (/backend|api|node|python|fastapi|django/.test(text)) return 'backend';
  if (/data|spark|airflow|etl|analytics|sql/.test(text)) return 'data';
  if (/security|iam|soc|cloud security/.test(text)) return 'security';
  if (/crm|salesforce|hubspot|zoho|customer relationship/.test(text)) return 'crm';
  if (/qa|automation|selenium|playwright|cypress/.test(text)) return 'qa';
  if (/business development|biz dev|partnership|sales|account executive|revenue/.test(text)) return 'biz-dev';
  if (/machine learning|mlops|pytorch|tensorflow|model/.test(text)) return 'ml';
  if (/\bai\b|llm|nlp|prompt/.test(text)) return 'ai';
  if (/devops|sre|kubernetes|terraform|aws|cloud/.test(text)) return 'devops';
  return 'all';
}

export default function HotlistAiPage() {
  const { account, user } = useAuth();
  const [roles, setRoles] = useState<HotlistRoleRow[]>([]);
  const [matches, setMatches] = useState<HotlistMatchRow[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [roleQuery, setRoleQuery] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const selectedRole = useMemo(() => roles.find((role) => role.id === selectedRoleId) ?? null, [roles, selectedRoleId]);

  const filteredRoles = useMemo(() => {
    const value = roleQuery.trim().toLowerCase();
    if (!value) return roles;
    return roles.filter((role) => {
      const haystack = [role.target_role, role.priority_skills, role.preferred_locations, role.visa_status, role.employment_type, role.work_type]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(value);
    });
  }, [roleQuery, roles]);

  const showToast = (message: string, type: 'success' | 'error' = 'success') => setToast({ message, type });

  async function loadRoles() {
    setLoading(true);
    const { data, error } = await supabase.from('hotlist_ai_roles').select('*').order('created_at', { ascending: false });
    if (error) {
      showToast(error.message, 'error');
      setLoading(false);
      return;
    }
    setRoles(data ?? []);
    if (!selectedRoleId && (data?.length ?? 0) > 0) {
      setSelectedRoleId(data?.[0].id ?? null);
    }
    setLoading(false);
  }

  async function loadMatches(roleId: string) {
    if (!roleId) {
      setMatches([]);
      return;
    }
    const { data, error } = await supabase.from('hotlist_ai_matches').select('*').eq('role_id', roleId).order('score', { ascending: false }).limit(20);
    if (!error) {
      setMatches(data ?? []);
    }
  }

  useEffect(() => {
    void loadRoles();
  }, [account?.id]);

  useEffect(() => {
    if (selectedRoleId) {
      void loadMatches(selectedRoleId);
    }
  }, [selectedRoleId]);

  async function handleClaimSuggestion(suggestion: (typeof HOTLIST_AI_SUGGESTIONS)[number]) {
    if (!account?.id) return;
    setClaiming(suggestion.id);
    try {
      const payload = {
        account_id: account.id,
        target_role: suggestion.title,
        category: inferRoleCategoryId(suggestion.title, suggestion.summary),
        years_exp: suggestion.minYearsExp,
        min_years_exp: suggestion.minYearsExp,
        max_years_exp: suggestion.maxYearsExp,
        visa_status: suggestion.visaStatus,
        employment_type: suggestion.employmentType,
        work_type: suggestion.workType,
        preferred_locations: suggestion.locations,
        min_rate_usd_per_hr: suggestion.minRate,
        max_rate_usd_per_hr: suggestion.maxRate,
        relocation_open: suggestion.relocationOpen,
        priority_skills: suggestion.skills,
        schedule_frequency: suggestion.scheduleFrequency,
        is_active: true,
      };
      const { data, error } = await supabase.from('hotlist_ai_roles').insert(payload).select().single();
      if (error) throw error;
      await loadRoles();
      setSelectedRoleId((data as HotlistRoleRow).id);
      showToast(`Added ${suggestion.title} to your bench and Hotlist AI.`, 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not claim role', 'error');
    } finally {
      setClaiming(null);
    }
  }

  async function handleRunMatch(roleId: string) {
    if (!account?.id || !user?.id) return;
    setRunning(true);
    try {
      const headers = await buildSupabaseFunctionHeaders(() => supabase.auth.getSession());
      const { data, error } = await supabase.functions.invoke('hotlist-ai-match', {
        body: { role_id: roleId, account_id: account.id },
        headers,
      });
      if (error) throw new Error(error.message || 'Match run failed');
      await loadRoles();
      await loadMatches(roleId);
      showToast(data?.summary || 'Match run completed.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Match run failed', 'error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <AppNav />
      <div className="mx-auto max-w-7xl px-4 py-6 lg:px-6">
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex-1 relative">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={roleQuery}
                onChange={(e) => setRoleQuery(e.target.value)}
                placeholder="Search roles, skills, locations..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-9 text-sm text-slate-700 shadow-sm outline-none transition focus:border-blue-400 focus:bg-white"
              />
              {roleQuery && (
                <button onClick={() => setRoleQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={12} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {roles.length} roles
              </div>
              <button onClick={() => selectedRole && handleRunMatch(selectedRole.id)} disabled={!selectedRole || running} className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 to-sky-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:from-blue-700 hover:to-sky-600 disabled:cursor-not-allowed disabled:opacity-60">
                {running ? <LogoSpinner size={14} /> : <RefreshCw size={14} />}
                Run match
              </button>
            </div>
          </div>
        </div>

        <div className="flex min-h-[720px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:flex-row">
          <aside className="w-full border-b border-slate-200 bg-white lg:w-80 lg:flex-shrink-0 lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wide text-slate-900">Roles</h2>
                  <p className="mt-1 text-[11px] text-slate-500">Claimed roles and starter catalog options</p>
                </div>
                <div className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{roles.length}</div>
              </div>
            </div>

            <div className="max-h-[320px] overflow-y-auto border-b border-slate-200 px-3 py-3">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <LogoSpinner size={20} />
                </div>
              ) : filteredRoles.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">No roles match that search.</div>
              ) : (
                <div className="space-y-2">
                  {filteredRoles.map((role) => (
                    <button key={role.id} onClick={() => setSelectedRoleId(role.id)} className={`w-full rounded-xl border p-3 text-left transition ${selectedRoleId === role.id ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">{role.target_role}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{role.priority_skills || 'No priority skills yet'}</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{formatSchedule(role.schedule_frequency)}</span>
                      </div>
                      <div className="mt-3 flex items-center gap-3 text-[11px] text-slate-500">
                        <span className="flex items-center gap-1"><Clock3 size={12} />{role.last_run_at ? new Date(role.last_run_at).toLocaleString() : 'Not run yet'}</span>
                        <span className="flex items-center gap-1"><CalendarClock size={12} />{role.is_active ? 'Active' : 'Paused'}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[11px] font-bold uppercase tracking-wide text-slate-900">Prefilled catalog</h3>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Starter roles</span>
              </div>
              <div className="space-y-2">
                {HOTLIST_AI_SUGGESTIONS.map((suggestion) => {
                  const alreadyClaimed = roles.some((role) => role.target_role === suggestion.title);
                  return (
                    <div key={suggestion.id} className="rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{suggestion.title}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{suggestion.summary}</p>
                        </div>
                        <button
                          onClick={() => handleClaimSuggestion(suggestion)}
                          disabled={claiming === suggestion.id || alreadyClaimed}
                          className="shrink-0 rounded-lg border border-blue-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {claiming === suggestion.id ? <LogoSpinner size={11} /> : alreadyClaimed ? <CheckCircle2 size={11} /> : <Plus size={11} />}
                        </button>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                        <span className="rounded-full bg-white px-2 py-0.5">{suggestion.yearsExp}+ yrs</span>
                        <span className="rounded-full bg-white px-2 py-0.5">{suggestion.workType}</span>
                        <span className="rounded-full bg-white px-2 py-0.5">{suggestion.locations}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-slate-200 bg-slate-50/70 px-4 py-4">
              {selectedRole ? (
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="rounded-xl bg-blue-600 p-2 text-white">
                        <Target size={14} />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-slate-900">{selectedRole.target_role}</h2>
                        <p className="text-sm text-slate-500">AI matching for this role is powered by your bench and the selected criteria.</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 shadow-sm">{formatSchedule(selectedRole.schedule_frequency)}</span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 shadow-sm">{selectedRole.is_active ? 'Active' : 'Paused'}</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">Choose a role from the left to inspect its criteria and AI matches.</div>
              )}
            </div>

            <div className="flex flex-1 flex-col overflow-hidden xl:flex-row">
              <div className="w-full border-b border-slate-200 bg-white p-4 xl:w-[340px] xl:flex-shrink-0 xl:border-b-0 xl:border-r">
                <div className="flex items-center gap-2">
                  <User size={14} className="text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-900">Role details</h3>
                </div>
                {selectedRole ? (
                  <div className="mt-4 space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <Briefcase size={12} />
                        Match rules
                      </div>
                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <div className="flex items-start justify-between gap-2 rounded-lg bg-white px-2.5 py-2">
                          <span className="text-slate-500">Years exp</span>
                          <span className="font-medium text-slate-900">{(selectedRole.min_years_exp != null && selectedRole.max_years_exp != null) ? `${selectedRole.min_years_exp}-${selectedRole.max_years_exp}` : selectedRole.years_exp ?? '—'}</span>
                        </div>
                        <div className="flex items-start justify-between gap-2 rounded-lg bg-white px-2.5 py-2">
                          <span className="text-slate-500">Visa</span>
                          <span className="font-medium text-slate-900">{selectedRole.visa_status ?? '—'}</span>
                        </div>
                        <div className="flex items-start justify-between gap-2 rounded-lg bg-white px-2.5 py-2">
                          <span className="text-slate-500">Employment</span>
                          <span className="font-medium text-slate-900">{selectedRole.employment_type ?? '—'}</span>
                        </div>
                        <div className="flex items-start justify-between gap-2 rounded-lg bg-white px-2.5 py-2">
                          <span className="text-slate-500">Work type</span>
                          <span className="font-medium text-slate-900">{selectedRole.work_type ?? '—'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-3">
                      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        <MapPin size={12} />
                        Preferences
                      </div>
                      <div className="mt-3 space-y-2 text-sm text-slate-700">
                        <div className="rounded-lg bg-slate-50 px-2.5 py-2">{selectedRole.preferred_locations || 'No preferred locations yet'}</div>
                        <div className="rounded-lg bg-slate-50 px-2.5 py-2">{selectedRole.priority_skills || 'No priority skills yet'}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-sm text-slate-500">Select a role to open its preferences and scoring rules.</div>
                )}
              </div>

              <div className="flex-1 min-w-0 overflow-y-auto bg-slate-50/70 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Matches</h3>
                    <p className="text-[11px] text-slate-500">Top matching consultants for the selected role.</p>
                  </div>
                  {selectedRole && (
                    <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500 shadow-sm">{matches.length} results</span>
                  )}
                </div>

                {!selectedRole ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No role selected yet.</div>
                ) : matches.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm text-slate-500">No matches yet. Run a match to score your bench against this role.</div>
                ) : (
                  <div className="space-y-2">
                    {matches.map((match) => (
                      <div key={match.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">{match.profile_id}</p>
                            <p className="mt-1 text-xs text-slate-500">{match.ai_notes || 'No notes provided'}</p>
                          </div>
                          <div className="rounded-full bg-blue-100 px-2.5 py-1 text-sm font-semibold text-blue-700">{Math.round(match.score)}%</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
