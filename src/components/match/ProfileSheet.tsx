import { useEffect, useState } from 'react';
import { ChevronLeft, Code2, FileText, Mail, ExternalLink, MapPin, Minus, Plus, Share2, ShieldCheck, Target, Upload, X } from 'lucide-react';
import LogoSpinner from '../LogoSpinner';
import { supabase } from '../../lib/supabase';
import { hashColor, placeOf } from '../../lib/match-fit';
import { loadTracker, strings, subjectName, type CardItem, type Kind, type Subject } from '../../lib/today';
import { uploadProfileResume } from '../../lib/resumes';
import { CompanyLogo, Initials, SkillTiles, UsMap } from './Visuals';

const STATUS_LABEL: Record<string, string> = { submitted: 'Applied', replied: 'Replied', interview: 'Interview', placed: 'Placed', closed: 'Closed' };

// A profile (or, for vendors, a job): what it is, its resumes, how many
// matches it gets a day, and how its applications are going.
export default function ProfileSheet({ subject, kind, newCount, accountId, mode, onClose, onSeeMatches, onChanged, showToast }: {
  subject: Subject; kind: Kind; newCount: number; accountId: string | undefined; mode: 'sheet' | 'drawer';
  onClose: () => void; onSeeMatches: () => void; onChanged: () => void; showToast: (msg: string) => void;
}) {
  const color = hashColor(subject.id);
  const name = subjectName(kind, subject);
  const [apps, setApps] = useState<CardItem[] | null>(null);
  const [cap, setCap] = useState<{ value: number; paid: boolean } | null>(null);
  // This profile's (or job's) matches on or off.
  const [matchesOn, setMatchesOn] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [resumes, setResumes] = useState(subject.resumes ?? []);
  useEffect(() => { setResumes(subject.resumes ?? []); }, [subject.resumes]);

  useEffect(() => {
    let alive = true;
    void loadTracker(kind).then((d) => { if (alive) setApps((d?.items ?? []).filter((i) => i.subject_id === subject.id)); }).catch(() => setApps([]));
    void supabase.rpc('get_match_caps' as never).then(({ data }: { data: { paid?: boolean; default_cap?: number; subjects?: Array<{ subject_id: string; cap: number; on?: boolean }> } | null }) => {
      if (!alive || !data) return;
      const mine = data.subjects?.find((c) => c.subject_id === subject.id);
      const own = mine?.cap;
      setMatchesOn(mine?.on !== false);
      setCap({ value: own ?? data.default_cap ?? (data.paid ? 30 : 10), paid: Boolean(data.paid) });
    });
    return () => { alive = false; };
  }, [kind, subject.id]);

  const changeCap = async (delta: number) => {
    if (!cap) return;
    if (!cap.paid) { showToast('Free plan: 10 matches a day. Paid plans choose up to 100.'); return; }
    const value = Math.max(5, Math.min(100, cap.value + delta));
    setCap({ ...cap, value });
    const { error } = await supabase.rpc('set_subject_match_cap' as never, { p_subject_id: subject.id, p_cap: value } as never);
    if (error) showToast('Could not change the daily matches.');
  };

  const makeDefault = async (fileId: string) => {
    setResumes((rs) => rs.map((r) => ({ ...r, is_default: r.id === fileId })));
    const { error } = await supabase.rpc('set_default_hotlist_resume' as never, { p_file_id: fileId } as never);
    if (error) showToast('Could not change the default resume.'); else onChanged();
  };

  const upload = async (file: File) => {
    if (!accountId) return;
    setUploading(true);
    try {
      const added = await uploadProfileResume(accountId, subject.id, file, resumes.length === 0);
      setResumes((rs) => [added, ...rs]);
      onChanged();
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not add the resume.');
    } finally {
      setUploading(false);
    }
  };

  const markPlaced = async () => {
    const { error } = await supabase.rpc('set_my_post_status' as never, { p_kind: kind, p_id: subject.id, p_status: 'closed' } as never);
    if (error) { showToast('Could not close it.'); return; }
    showToast(kind === 'hotlist' ? `${name} marked placed. No more matches for this profile.` : 'Job closed. No more matches for it.');
    onChanged();
    onClose();
  };

  const share = async () => {
    const url = `${window.location.origin}/${kind === 'hotlist' ? 'hotlist' : 'job'}/${subject.id}`;
    try {
      if (navigator.share) { await navigator.share({ title: subject.title ?? name, url }); return; }
      await navigator.clipboard.writeText(url);
      showToast('Link copied. Share it with vendors.');
    } catch { /* cancelled */ }
  };

  const reached = (stages: string[]) => (apps ?? []).filter((a) => stages.includes(a.stage)).length;
  const home = kind === 'hotlist' ? placeOf(strings(subject.locations)[0]) : placeOf(subject.location);
  const tile = 'flex flex-col rounded-xl border border-gray-200 bg-white px-2.5 py-2 text-left dark:border-white/10 dark:bg-[#20242a]';
  const box = 'rounded-2xl border border-gray-200 bg-white px-3.5 py-3 dark:border-white/10 dark:bg-[#20242a]';
  const boxTitle = 'mb-2 flex items-center gap-1.5 text-[11.5px] font-bold uppercase tracking-[0.07em] text-gray-400';

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f3f2ee] dark:bg-[#1B1D21]">
      <div className="flex h-14 shrink-0 items-center gap-1 border-b border-gray-200 bg-white px-1.5 dark:border-white/10 dark:bg-[#20242a]">
        <button type="button" onClick={onClose} aria-label={mode === 'drawer' ? 'Close' : 'Back'} className="grid h-9 w-9 place-items-center rounded-[10px] text-gray-500 hover:bg-gray-100 dark:hover:bg-white/5">
          {mode === 'drawer' ? <X size={20} /> : <ChevronLeft size={22} />}
        </button>
        <span className="flex-1 text-[13px] font-semibold text-gray-400">{kind === 'hotlist' ? 'Profile' : 'Job'}</span>
      </div>
      <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-4">
        <div className="relative mb-9 h-[88px] rounded-2xl" style={{ background: `linear-gradient(120deg, ${color}, color-mix(in srgb, ${color} 45%, #ec4899))` }}>
          <span className="absolute -bottom-9 left-4 rounded-full bg-[#f3f2ee] p-1 dark:bg-[#1B1D21]"><Initials name={name} id={subject.id} size={76} /></span>
        </div>
        <div>
          <h2 className="text-[21px] font-extrabold tracking-tight">{kind === 'hotlist' ? (subject.name || name) : name}</h2>
          {kind === 'hotlist' && <p className="text-gray-600 dark:text-slate-400">{subject.title}</p>}
        </div>

        <div className="grid grid-cols-4 gap-2">
          <button type="button" className={tile} onClick={onSeeMatches}><b className="text-[20px] font-extrabold tabular-nums">{newCount}</b><span className="text-[11.5px] font-semibold text-gray-400">New</span></button>
          <div className={tile}><b className="text-[20px] font-extrabold tabular-nums">{apps?.length ?? '–'}</b><span className="text-[11.5px] font-semibold text-gray-400">Applied</span></div>
          <div className={tile}><b className="text-[20px] font-extrabold tabular-nums">{apps ? reached(['replied', 'interview', 'placed']) : '–'}</b><span className="text-[11.5px] font-semibold text-gray-400">Replies</span></div>
          <div className={tile}><b className="text-[20px] font-extrabold tabular-nums">{apps ? reached(['interview', 'placed']) : '–'}</b><span className="text-[11.5px] font-semibold text-gray-400">Interviews</span></div>
        </div>
        {newCount > 0 && (
          <button type="button" onClick={onSeeMatches} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[15px] font-bold text-white hover:bg-blue-700">
            <Target size={17} />See {newCount} new {newCount === 1 ? 'match' : 'matches'}
          </button>
        )}

        <section className={box}>
          <h4 className={boxTitle}><Code2 size={13} />Skills</h4>
          <SkillTiles skills={strings(subject.skills).slice(0, 12).map((s) => ({ name: s, ok: true }))} />
        </section>

        <section className="grid grid-cols-2 gap-2.5">
          <div className={box}>
            <h4 className={boxTitle}><MapPin size={13} />{kind === 'hotlist' ? 'Based in' : 'Location'}</h4>
            <UsMap jobState={null} profileState={home.state} remote={home.remote} profileColor={color} />
            <p className="mt-2 truncate text-[12px] font-semibold text-gray-600 dark:text-slate-300">{kind === 'hotlist' ? strings(subject.locations).join(', ') || 'Not listed' : subject.location || 'Not listed'}</p>
          </div>
          <div className={box}>
            <h4 className={boxTitle}><ShieldCheck size={13} />Visa and rate</h4>
            <p className="text-[22px] font-extrabold text-emerald-600 dark:text-emerald-400">{kind === 'hotlist' ? subject.visa || '–' : strings(subject.visas).slice(0, 2).join(', ') || 'Any'}</p>
            <p className="text-[22px] font-extrabold">{subject.rate_min ? `$${Math.round(subject.rate_min)}` : '–'}<small className="text-[12px] font-bold text-gray-400">/hr</small></p>
            <p className="text-[12px] font-semibold text-gray-500">{subject.years ? `${Math.round(subject.years)} years` : ''}</p>
          </div>
        </section>

        {kind === 'hotlist' && (
          <section className={box}>
            <h4 className={boxTitle}><FileText size={13} />Resumes</h4>
            <div className="flex gap-2.5 overflow-x-auto pb-1">
              {resumes.map((r) => (
                <button key={r.id} type="button" onClick={() => !r.is_default && void makeDefault(r.id)}
                  className={`flex w-[104px] shrink-0 flex-col gap-1.5 rounded-xl border bg-white p-2 text-left dark:bg-[#20242a] ${r.is_default ? 'border-emerald-500 shadow-[0_0_0_2px_rgba(16,185,129,.3)]' : 'border-gray-200 dark:border-white/10'}`}>
                  <span className="flex h-[84px] flex-col gap-[5px] rounded-md bg-gray-100 p-[7px] dark:bg-white/5" aria-hidden="true">
                    <i className="h-2 w-3/5 rounded-sm" style={{ background: color }} />
                    {[100, 80, 100, 55, 90].map((w, k) => <i key={k} className="h-1 rounded-sm bg-gray-300 dark:bg-white/15" style={{ width: `${w}%` }} />)}
                  </span>
                  <small className="truncate text-[11px] font-bold">{r.file_name}</small>
                  <em className={`text-[10.5px] font-extrabold not-italic ${r.is_default ? 'text-emerald-600' : 'text-blue-600'}`}>{r.is_default ? 'Default' : 'Make default'}</em>
                </button>
              ))}
              <label className="flex min-h-[134px] w-[104px] shrink-0 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 text-blue-600 hover:bg-blue-50 dark:border-white/15 dark:hover:bg-blue-500/10">
                {uploading ? <LogoSpinner size={18} /> : <Upload size={22} />}
                <small className="text-[11px] font-bold">Add resume</small>
                <input type="file" accept=".pdf,.doc,.docx" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(f); }} />
              </label>
            </div>
          </section>
        )}

        <section className={box}>
          <h4 className={boxTitle}>Matching</h4>
          <div className="mb-3 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <b className="block text-[14px]">New matches</b>
              <small className="block text-[12px] text-gray-500">{matchesOn ? `On: new ${kind === 'hotlist' ? 'jobs' : 'profiles'} come for ${name} every day` : 'Off: nothing new comes for this one'}</small>
            </div>
            <button type="button" role="switch" aria-checked={matchesOn} aria-label="New matches"
              onClick={() => {
                const next = !matchesOn;
                setMatchesOn(next);
                void supabase.rpc('set_subject_matches' as never, { p_subject_id: subject.id, p_on: next } as never).then(({ error }) => {
                  if (error) { setMatchesOn(!next); showToast('Could not change it.'); } else { showToast(next ? 'Matches on' : 'Matches off'); onChanged(); }
                });
              }}
              className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${matchesOn ? 'bg-green-600' : 'bg-gray-300 dark:bg-white/20'}`}>
              <span className={`absolute h-5 w-5 rounded-full bg-white shadow transition-transform ${matchesOn ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          <div className={`flex items-center gap-3 ${matchesOn ? '' : 'pointer-events-none opacity-40'}`}>
            <div className="min-w-0 flex-1">
              <b className="block text-[14px]">Matches a day</b>
              <small className="block text-[12px] text-gray-500">{cap?.paid ? 'Up to 100 on your plan' : 'Free plan: 10 a day in all. Paid: up to 100 each.'}</small>
            </div>
            <div className="flex items-center overflow-hidden rounded-[10px] border border-gray-200 dark:border-white/10">
              <button type="button" onClick={() => void changeCap(-5)} aria-label="Fewer" className="grid h-8 w-9 place-items-center bg-gray-50 dark:bg-white/5"><Minus size={14} /></button>
              <b className="w-10 text-center tabular-nums">{cap?.value ?? '–'}</b>
              <button type="button" onClick={() => void changeCap(5)} aria-label="More" className="grid h-8 w-9 place-items-center bg-gray-50 dark:bg-white/5"><Plus size={14} /></button>
            </div>
          </div>
        </section>

        <section className={box}>
          <h4 className={boxTitle}>Recent</h4>
          {apps == null ? <div className="flex justify-center py-3"><LogoSpinner size={16} /></div> : apps.length === 0 ? (
            <p className="text-[13px] text-gray-400">Nothing applied yet.</p>
          ) : apps.slice(0, 4).map((a) => a.lead && (
            <div key={a.card_id} className="flex items-center gap-2.5 border-t border-gray-100 py-2 first:border-0 dark:border-white/5">
              <span className="relative inline-flex shrink-0">
                <CompanyLogo name={a.lead.company || a.lead.poster || a.lead.title} avatar={a.lead.avatar} domain={a.lead.logo_domain} size={34} round={Boolean(a.lead.avatar)} />
                <span className={`absolute -bottom-1 -right-1 grid h-[17px] w-[17px] place-items-center rounded-full border-2 border-white text-white dark:border-[#20242a] ${a.how === 'site' ? 'bg-emerald-600' : 'bg-blue-600'}`}>{a.how === 'site' ? <ExternalLink size={8} strokeWidth={3} /> : <Mail size={8} strokeWidth={3} />}</span>
              </span>
              <div className="min-w-0 flex-1"><p className="truncate text-[13.5px] font-bold">{a.lead.title}</p><p className="truncate text-[12px] text-gray-400">{a.lead.company || a.lead.poster}</p></div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] font-bold text-gray-600 dark:bg-white/10 dark:text-slate-300">{STATUS_LABEL[a.stage] ?? a.stage}</span>
            </div>
          ))}
        </section>
      </div>
      <div className="flex shrink-0 gap-2 border-t border-gray-200 bg-white px-3.5 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] dark:border-white/10 dark:bg-[#20242a]">
        <button type="button" onClick={() => void markPlaced()} className="h-12 shrink-0 rounded-xl border border-gray-300 px-4 text-[14px] font-bold text-gray-700 hover:bg-gray-50 dark:border-white/15 dark:text-slate-200 dark:hover:bg-white/5">
          {kind === 'hotlist' ? 'Mark placed' : 'Close job'}
        </button>
        <button type="button" onClick={() => void share()} className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 text-[15px] font-bold text-white hover:bg-blue-700">
          <Share2 size={16} />Share {kind === 'hotlist' ? 'profile' : 'job'}
        </button>
      </div>
    </div>
  );
}
