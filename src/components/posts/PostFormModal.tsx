import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Sparkles, Trash2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import ChipInput from '../ChipInput';
import LocationChipInput from '../LocationChipInput';
import LocationAutosuggestInput from '../LocationAutosuggestInput';
import InsufficientCreditsModal from '../InsufficientCreditsModal';

export type PostKind = 'job' | 'hotlist';

export interface UserPost {
  id: string;
  kind: PostKind;
  title: string;
  company: string;
  location: string;
  employmentType: string;
  seniorityLevel: string;
  salaryRange: string;
  jobDescription: string;
  postContent: string;
  skills: string[];
  experienceYears: number | null;
  visaTypes: string[];
  hourlyRateMin: number | null;
  hourlyRateMax: number | null;
  contactEmail: string;
  contactPhone: string;
  candidateName: string;
  visaType: string;
  workType: string;
  locations: string[];
  availability: string;
  candidateSummary: string;
  postStatus: 'open' | 'closed';
  createdAt: string;
}

function parseNumberInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

interface JobFormState {
  jobTitle: string;
  companyName: string;
  location: string;
  employmentType: string;
  seniorityLevel: string;
  salaryRange: string;
  jobDescription: string;
  skills: string[];
  experienceYears: string;
  visaTypes: string[];
  hourlyRateMin: string;
  hourlyRateMax: string;
  contactEmail: string;
  contactPhone: string;
}

interface HotlistFormState {
  roleTitle: string;
  coreSkills: string[];
  yearsExperience: string;
  visaType: string;
  employmentType: string;
  workType: string;
  locations: string[];
  hourlyRateMin: string;
  hourlyRateMax: string;
  availability: string;
  candidateSummary: string;
  contactEmail: string;
  contactPhone: string;
}

const EMPTY_JOB_FORM: JobFormState = {
  jobTitle: '', companyName: '', location: '', employmentType: '', seniorityLevel: '',
  salaryRange: '', jobDescription: '', skills: [], experienceYears: '',
  visaTypes: [], hourlyRateMin: '', hourlyRateMax: '', contactEmail: '', contactPhone: '',
};

const EMPTY_HOTLIST_FORM: HotlistFormState = {
  roleTitle: '', coreSkills: [], yearsExperience: '', visaType: '',
  employmentType: '', workType: '', locations: [], hourlyRateMin: '', hourlyRateMax: '',
  availability: '', candidateSummary: '', contactEmail: '', contactPhone: '',
};

function jobFormFromPost(post: UserPost | null): JobFormState {
  if (!post) return EMPTY_JOB_FORM;
  return {
    jobTitle: post.title,
    companyName: post.company,
    location: post.location,
    employmentType: post.employmentType,
    seniorityLevel: post.seniorityLevel,
    salaryRange: post.salaryRange,
    jobDescription: post.jobDescription,
    skills: post.skills,
    experienceYears: post.experienceYears != null ? String(post.experienceYears) : '',
    visaTypes: post.visaTypes,
    hourlyRateMin: post.hourlyRateMin != null ? String(post.hourlyRateMin) : '',
    hourlyRateMax: post.hourlyRateMax != null ? String(post.hourlyRateMax) : '',
    contactEmail: post.contactEmail,
    contactPhone: post.contactPhone,
  };
}

function hotlistFormFromPost(post: UserPost | null): HotlistFormState {
  if (!post) return EMPTY_HOTLIST_FORM;
  return {
    roleTitle: post.title,
    coreSkills: post.skills,
    yearsExperience: post.experienceYears != null ? String(post.experienceYears) : '',
    visaType: post.visaType,
    employmentType: post.employmentType,
    workType: post.workType,
    locations: post.locations,
    hourlyRateMin: post.hourlyRateMin != null ? String(post.hourlyRateMin) : '',
    hourlyRateMax: post.hourlyRateMax != null ? String(post.hourlyRateMax) : '',
    availability: post.availability,
    candidateSummary: post.candidateSummary,
    contactEmail: post.contactEmail,
    contactPhone: post.contactPhone,
  };
}

type ExtractedJobFields = {
  job_title?: string; company_name?: string; location?: string; employment_type?: string;
  seniority_level?: string; salary_range?: string; job_description?: string; skills?: string[];
  experience_years?: number; visa_types?: string[]; hourly_rate_min?: number; hourly_rate_max?: number;
  contact_email?: string; contact_phone?: string;
};

type ExtractedHotlistCandidate = {
  role_title?: string; candidate_name?: string; core_skills?: string[]; years_experience?: number;
  visa_type?: string; employment_type?: string; work_type?: string; locations?: string[];
  hourly_rate_min?: number; hourly_rate_max?: number; availability?: string; candidate_summary?: string;
};

type ExtractedHotlistFields = ExtractedHotlistCandidate & {
  contact_email?: string; contact_phone?: string;
};

// One row in the multi-candidate review list — shown instead of the single
// hotlist form when a paste is detected to contain more than one consultant
// (the standard bench-sales "table of available consultants" post format).
interface HotlistCandidateDraft {
  candidateName: string;
  roleTitle: string;
  yearsExperience: string;
  coreSkills: string[];
  visaType: string;
  employmentType: string;
  workType: string;
  locations: string[];
  hourlyRateMin: string;
  hourlyRateMax: string;
  availability: string;
  candidateSummary: string;
}

function candidateDraftFromExtracted(c: ExtractedHotlistCandidate): HotlistCandidateDraft {
  return {
    candidateName: c.candidate_name?.trim() ?? '',
    roleTitle: c.role_title?.trim() ?? '',
    yearsExperience: c.years_experience ? String(c.years_experience) : '',
    coreSkills: Array.isArray(c.core_skills) ? c.core_skills : [],
    visaType: c.visa_type?.trim() ?? '',
    employmentType: c.employment_type?.trim() ?? '',
    workType: c.work_type?.trim() ?? '',
    locations: Array.isArray(c.locations) ? c.locations : [],
    hourlyRateMin: c.hourly_rate_min ? String(c.hourly_rate_min) : '',
    hourlyRateMax: c.hourly_rate_max ? String(c.hourly_rate_max) : '',
    availability: c.availability?.trim() ?? '',
    candidateSummary: c.candidate_summary?.trim() ?? '',
  };
}

export default function PostFormModal({
  kind,
  existingPost,
  initialPasteText,
  onClose,
  onSaved,
  showToast,
}: {
  kind: PostKind;
  existingPost: UserPost | null;
  initialPasteText?: string;
  onClose: () => void;
  onSaved: () => void;
  showToast: (message: string, type?: 'success' | 'error') => void;
}) {
  const { isDark } = useTheme();
  const { account } = useAuth();
  const [showOutOfCreditsModal, setShowOutOfCreditsModal] = useState(false);
  const inputClass = `w-full rounded-md border px-2.5 py-1.5 text-[12px] outline-none transition-colors focus:ring-2 ${
    isDark
      ? 'border-white/15 bg-[#171a1f] text-slate-100 placeholder:text-[#64748B] focus:border-blue-500 focus:ring-blue-500/20'
      : 'border-gray-200 bg-white text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:ring-blue-100'
  }`;
  const labelClass = `mb-1 block text-[11px] font-semibold ${isDark ? 'text-[#94A3B8]' : 'text-gray-600'}`;
  const [jobForm, setJobForm] = useState<JobFormState>(() => jobFormFromPost(existingPost));
  const [hotlistForm, setHotlistForm] = useState<HotlistFormState>(() => hotlistFormFromPost(existingPost));
  const [pasteText, setPasteText] = useState(existingPost?.postContent ?? initialPasteText ?? '');
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showMore, setShowMore] = useState(Boolean(existingPost));
  const [parsedCandidates, setParsedCandidates] = useState<HotlistCandidateDraft[]>([]);
  const isMultiCandidateMode = kind === 'hotlist' && parsedCandidates.length > 0;
  const autoFillTriggeredRef = useRef(false);

  useEffect(() => {
    setJobForm(jobFormFromPost(existingPost));
    setHotlistForm(hotlistFormFromPost(existingPost));
    setPasteText(existingPost?.postContent ?? initialPasteText ?? '');
    setParsedCandidates([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingPost]);

  // Arriving here with text already pasted on the Posts page (rather than
  // typed into this modal) — run the same extraction immediately instead of
  // making the user click "Auto-fill" again for text they already supplied.
  useEffect(() => {
    if (autoFillTriggeredRef.current) return;
    if (!existingPost && initialPasteText && initialPasteText.trim()) {
      autoFillTriggeredRef.current = true;
      void handleAutoFill();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isEditing = Boolean(existingPost);
  const title = kind === 'job'
    ? (isEditing ? 'Edit job post' : 'Post a job')
    : (isEditing ? 'Edit hotlist post' : 'Post a consultant');

  async function handleAutoFill() {
    if (!pasteText.trim() || extracting) return;
    setExtracting(true);
    try {
      const { data, error } = await supabase.functions.invoke('extract-post-fields', {
        body: { kind, text: pasteText.trim() },
      });
      if (error || !data?.ok) throw new Error(data?.error || error?.message || 'Could not auto-fill from that text');

      if (kind === 'job') {
        const f = data.fields as ExtractedJobFields;
        setJobForm((prev) => ({
          jobTitle: f.job_title?.trim() || prev.jobTitle,
          companyName: f.company_name?.trim() || prev.companyName,
          location: f.location?.trim() || prev.location,
          employmentType: f.employment_type?.trim() || prev.employmentType,
          seniorityLevel: f.seniority_level?.trim() || prev.seniorityLevel,
          salaryRange: f.salary_range?.trim() || prev.salaryRange,
          jobDescription: f.job_description?.trim() || prev.jobDescription,
          skills: Array.isArray(f.skills) && f.skills.length > 0 ? f.skills : prev.skills,
          experienceYears: f.experience_years ? String(f.experience_years) : prev.experienceYears,
          visaTypes: Array.isArray(f.visa_types) && f.visa_types.length > 0 ? f.visa_types : prev.visaTypes,
          hourlyRateMin: f.hourly_rate_min ? String(f.hourly_rate_min) : prev.hourlyRateMin,
          hourlyRateMax: f.hourly_rate_max ? String(f.hourly_rate_max) : prev.hourlyRateMax,
          contactEmail: f.contact_email?.trim() || prev.contactEmail,
          contactPhone: f.contact_phone?.trim() || prev.contactPhone,
        }));
      } else {
        const candidates = Array.isArray(data.candidates) ? data.candidates as ExtractedHotlistCandidate[] : [];
        // Editing an existing post always maps to exactly one social_hotlist
        // row, so even if the newly-pasted text looks like a multi-candidate
        // table, stay in single-candidate mode for edits.
        if (!isEditing && candidates.length > 1) {
          setParsedCandidates(candidates.map(candidateDraftFromExtracted));
          setHotlistForm((prev) => ({
            ...prev,
            contactEmail: data.contact_email?.trim() || prev.contactEmail,
            contactPhone: data.contact_phone?.trim() || prev.contactPhone,
          }));
        } else {
          setParsedCandidates([]);
          const f = data.fields as ExtractedHotlistFields;
          setHotlistForm((prev) => ({
            roleTitle: f.role_title?.trim() || prev.roleTitle,
            coreSkills: Array.isArray(f.core_skills) && f.core_skills.length > 0 ? f.core_skills : prev.coreSkills,
            yearsExperience: f.years_experience ? String(f.years_experience) : prev.yearsExperience,
            visaType: f.visa_type?.trim() || prev.visaType,
            employmentType: f.employment_type?.trim() || prev.employmentType,
            workType: f.work_type?.trim() || prev.workType,
            locations: Array.isArray(f.locations) && f.locations.length > 0 ? f.locations : prev.locations,
            hourlyRateMin: f.hourly_rate_min ? String(f.hourly_rate_min) : prev.hourlyRateMin,
            hourlyRateMax: f.hourly_rate_max ? String(f.hourly_rate_max) : prev.hourlyRateMax,
            availability: f.availability?.trim() || prev.availability,
            candidateSummary: f.candidate_summary?.trim() || prev.candidateSummary,
            contactEmail: f.contact_email?.trim() || prev.contactEmail,
            contactPhone: f.contact_phone?.trim() || prev.contactPhone,
          }));
        }
      }
      setShowMore(true);
      showToast('Fields auto-filled — review and adjust before posting', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not auto-fill from that text', 'error');
    } finally {
      setExtracting(false);
    }
  }

  async function handleSubmit() {
    setSaving(true);
    try {
      if (kind === 'job') {
        if (!jobForm.jobTitle.trim()) throw new Error('Job title is required');
        const args = {
          p_job_title: jobForm.jobTitle.trim(),
          p_company_name: jobForm.companyName.trim(),
          p_location: jobForm.location.trim(),
          p_employment_type: jobForm.employmentType.trim(),
          p_seniority_level: jobForm.seniorityLevel.trim(),
          p_salary_range: jobForm.salaryRange.trim(),
          p_job_description: jobForm.jobDescription.trim(),
          p_post_content: pasteText.trim(),
          p_skills: jobForm.skills,
          p_experience_years: parseNumberInput(jobForm.experienceYears),
          p_visa_types: jobForm.visaTypes,
          p_hourly_rate_min: parseNumberInput(jobForm.hourlyRateMin),
          p_hourly_rate_max: parseNumberInput(jobForm.hourlyRateMax),
          p_contact_email: jobForm.contactEmail.trim(),
          p_contact_phone: jobForm.contactPhone.trim(),
        };
        const { error } = isEditing
          ? await supabase.rpc('update_user_job_post' as never, { p_id: existingPost!.id, ...args, p_post_status: existingPost!.postStatus } as never)
          : await supabase.rpc('create_user_job_post' as never, args as never);
        if (error) throw new Error(error.message);
      } else if (isMultiCandidateMode) {
        if (parsedCandidates.length === 0) throw new Error('No candidates to post');
        if (parsedCandidates.some((c) => !c.roleTitle.trim())) throw new Error('Every candidate needs a role title');
        const candidatesPayload = parsedCandidates.map((c) => ({
          role_title: c.roleTitle.trim(),
          candidate_name: c.candidateName.trim(),
          core_skills: c.coreSkills,
          years_experience: parseNumberInput(c.yearsExperience),
          visa_type: c.visaType.trim(),
          employment_type: c.employmentType.trim(),
          work_type: c.workType.trim(),
          locations: c.locations,
          hourly_rate_min: parseNumberInput(c.hourlyRateMin),
          hourly_rate_max: parseNumberInput(c.hourlyRateMax),
          availability: c.availability.trim(),
          candidate_summary: c.candidateSummary.trim(),
        }));
        const { error } = await supabase.rpc('create_user_hotlist_posts_batch' as never, {
          p_candidates: candidatesPayload,
          p_post_content: pasteText.trim(),
          p_contact_email: hotlistForm.contactEmail.trim(),
          p_contact_phone: hotlistForm.contactPhone.trim(),
        } as never);
        if (error) throw new Error(error.message);
      } else {
        if (!hotlistForm.roleTitle.trim()) throw new Error('Role title is required');
        const args = {
          p_role_title: hotlistForm.roleTitle.trim(),
          p_core_skills: hotlistForm.coreSkills,
          p_years_experience: parseNumberInput(hotlistForm.yearsExperience),
          p_visa_type: hotlistForm.visaType.trim(),
          p_employment_type: hotlistForm.employmentType.trim(),
          p_work_type: hotlistForm.workType.trim(),
          p_locations: hotlistForm.locations,
          p_hourly_rate_min: parseNumberInput(hotlistForm.hourlyRateMin),
          p_hourly_rate_max: parseNumberInput(hotlistForm.hourlyRateMax),
          p_availability: hotlistForm.availability.trim(),
          p_candidate_summary: hotlistForm.candidateSummary.trim(),
          p_post_content: pasteText.trim(),
          p_contact_email: hotlistForm.contactEmail.trim(),
          p_contact_phone: hotlistForm.contactPhone.trim(),
        };
        const { error } = isEditing
          ? await supabase.rpc('update_user_hotlist_post' as never, { p_id: existingPost!.id, ...args, p_post_status: existingPost!.postStatus } as never)
          : await supabase.rpc('create_user_hotlist_post' as never, args as never);
        if (error) throw new Error(error.message);
      }
      showToast(isEditing ? 'Post updated' : isMultiCandidateMode ? `${parsedCandidates.length} posts created — they will appear in the feed shortly` : 'Post created — it will appear in the feed shortly', 'success');
      onSaved();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not save post';
      if (message.startsWith('INSUFFICIENT_CREDITS:')) {
        setShowOutOfCreditsModal(true);
      } else {
        showToast(message, 'error');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => !saving && onClose()}>
      <div
        className={`max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-lg border p-4 shadow-xl ${isDark ? 'border-white/10 bg-[#1B1D21]' : 'border-gray-200 bg-white'}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-bold text-gray-900 dark:text-slate-100">{title}</h2>
          <button type="button" onClick={onClose} className={`rounded-full p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5' : 'text-gray-400 hover:bg-gray-100 hover:text-gray-600'}`}>
            <X size={16} />
          </button>
        </div>

        <div className={`mb-3 rounded-md border p-2.5 ${isDark ? 'border-blue-400/20 bg-blue-500/5' : 'border-blue-100 bg-blue-50/50'}`}>
          <label className={labelClass}>
            Paste your post {kind === 'job' ? '(the job description you already wrote)' : "(the consultant's availability post you already wrote)"} — optional
          </label>
          <textarea
            className={inputClass}
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={kind === 'job' ? 'Paste the job posting text here…' : 'Paste the hotlist/consultant post text here…'}
          />
          <button
            type="button"
            onClick={() => void handleAutoFill()}
            disabled={!pasteText.trim() || extracting}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-[11px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Sparkles size={12} />
            {extracting ? 'Auto-filling…' : 'Auto-fill fields from this text'}
          </button>
        </div>

        {kind === 'job' ? (
          <div className="space-y-2.5">
            <div>
              <label className={labelClass}>Job title *</label>
              <input className={inputClass} value={jobForm.jobTitle} onChange={(e) => setJobForm({ ...jobForm, jobTitle: e.target.value })} placeholder="Senior React Developer" />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className={labelClass}>Company</label>
                <input className={inputClass} value={jobForm.companyName} onChange={(e) => setJobForm({ ...jobForm, companyName: e.target.value })} />
              </div>
              <div>
                <label className={labelClass}>Location</label>
                <LocationAutosuggestInput
                  value={jobForm.location}
                  onChange={(value) => setJobForm({ ...jobForm, location: value })}
                  onSelectPlace={(place) => setJobForm((prev) => ({ ...prev, location: place.formatted || prev.location }))}
                  scope="any"
                  placeholder="Remote or local to TX"
                  inputClassName={isDark ? '!border-white/15 !bg-[#171a1f] !text-slate-100 placeholder:!text-[#64748B]' : ''}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Skills</label>
              <ChipInput values={jobForm.skills} onChange={(skills) => setJobForm({ ...jobForm, skills })} placeholder="React, TypeScript, Node…" />
            </div>
            <div>
              <label className={labelClass}>Contact email *</label>
              <input className={inputClass} type="email" value={jobForm.contactEmail} onChange={(e) => setJobForm({ ...jobForm, contactEmail: e.target.value })} placeholder="you@company.com" />
            </div>

            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className={`inline-flex items-center gap-1 text-[11px] font-semibold ${isDark ? 'text-[#94A3B8] hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {showMore ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showMore ? 'Hide more details' : 'Add more details (optional)'}
            </button>

            {showMore && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={labelClass}>Employment type</label>
                    <input className={inputClass} value={jobForm.employmentType} onChange={(e) => setJobForm({ ...jobForm, employmentType: e.target.value })} placeholder="C2C, W2, 1099" />
                  </div>
                  <div>
                    <label className={labelClass}>Seniority</label>
                    <input className={inputClass} value={jobForm.seniorityLevel} onChange={(e) => setJobForm({ ...jobForm, seniorityLevel: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className={labelClass}>Rate min ($/hr)</label>
                    <input className={inputClass} inputMode="decimal" value={jobForm.hourlyRateMin} onChange={(e) => setJobForm({ ...jobForm, hourlyRateMin: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Rate max ($/hr)</label>
                    <input className={inputClass} inputMode="decimal" value={jobForm.hourlyRateMax} onChange={(e) => setJobForm({ ...jobForm, hourlyRateMax: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Experience (yrs)</label>
                    <input className={inputClass} inputMode="numeric" value={jobForm.experienceYears} onChange={(e) => setJobForm({ ...jobForm, experienceYears: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Salary range</label>
                  <input className={inputClass} value={jobForm.salaryRange} onChange={(e) => setJobForm({ ...jobForm, salaryRange: e.target.value })} placeholder="$120k-$140k/yr" />
                </div>
                <div>
                  <label className={labelClass}>Visa types accepted</label>
                  <ChipInput values={jobForm.visaTypes} onChange={(visaTypes) => setJobForm({ ...jobForm, visaTypes })} placeholder="H1B, GC, USC…" />
                </div>
                <div>
                  <label className={labelClass}>Job description</label>
                  <textarea className={inputClass} rows={4} value={jobForm.jobDescription} onChange={(e) => setJobForm({ ...jobForm, jobDescription: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass}>Contact phone</label>
                  <input className={inputClass} value={jobForm.contactPhone} onChange={(e) => setJobForm({ ...jobForm, contactPhone: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        ) : isMultiCandidateMode ? (
          <div className="space-y-2.5">
            <div className={`rounded-md border p-2.5 text-[12px] font-semibold ${isDark ? 'border-emerald-400/20 bg-emerald-500/5 text-emerald-300' : 'border-emerald-100 bg-emerald-50 text-emerald-700'}`}>
              {parsedCandidates.length} candidates found — review the key fields below before posting.{' '}
              <button
                type="button"
                onClick={() => setParsedCandidates([])}
                className={`underline ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}
              >
                Post one consultant instead
              </button>
            </div>

            <div className="space-y-2">
              {parsedCandidates.map((candidate, index) => (
                <div key={index} className={`rounded-md border p-2.5 ${isDark ? 'border-white/10 bg-[#171a1f]' : 'border-gray-200 bg-gray-50/50'}`}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`text-[11px] font-bold ${isDark ? 'text-[#94A3B8]' : 'text-gray-500'}`}>Candidate {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => setParsedCandidates((prev) => prev.filter((_, i) => i !== index))}
                      className={`rounded p-1 transition-colors ${isDark ? 'text-[#94A3B8] hover:bg-white/5 hover:text-red-400' : 'text-gray-400 hover:bg-gray-100 hover:text-red-600'}`}
                      aria-label={`Remove candidate ${index + 1}`}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelClass}>Name</label>
                      <input
                        className={inputClass}
                        value={candidate.candidateName}
                        onChange={(e) => setParsedCandidates((prev) => prev.map((c, i) => (i === index ? { ...c, candidateName: e.target.value } : c)))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Role title *</label>
                      <input
                        className={inputClass}
                        value={candidate.roleTitle}
                        onChange={(e) => setParsedCandidates((prev) => prev.map((c, i) => (i === index ? { ...c, roleTitle: e.target.value } : c)))}
                      />
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelClass}>Experience (yrs)</label>
                      <input
                        className={inputClass}
                        inputMode="numeric"
                        value={candidate.yearsExperience}
                        onChange={(e) => setParsedCandidates((prev) => prev.map((c, i) => (i === index ? { ...c, yearsExperience: e.target.value } : c)))}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Skills</label>
                      <ChipInput
                        values={candidate.coreSkills}
                        onChange={(coreSkills) => setParsedCandidates((prev) => prev.map((c, i) => (i === index ? { ...c, coreSkills } : c)))}
                        placeholder="Java, Spring Boot…"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div>
              <label className={labelClass}>Contact email * (applies to every candidate above)</label>
              <input className={inputClass} type="email" value={hotlistForm.contactEmail} onChange={(e) => setHotlistForm({ ...hotlistForm, contactEmail: e.target.value })} placeholder="you@company.com" />
            </div>
            <div>
              <label className={labelClass}>Contact phone</label>
              <input className={inputClass} value={hotlistForm.contactPhone} onChange={(e) => setHotlistForm({ ...hotlistForm, contactPhone: e.target.value })} />
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div>
              <label className={labelClass}>Role title *</label>
              <input className={inputClass} value={hotlistForm.roleTitle} onChange={(e) => setHotlistForm({ ...hotlistForm, roleTitle: e.target.value })} placeholder="Senior Java Full Stack Developer" />
            </div>
            <div>
              <label className={labelClass}>Locations</label>
              <LocationChipInput values={hotlistForm.locations} onChange={(locations) => setHotlistForm({ ...hotlistForm, locations })} />
            </div>
            <div>
              <label className={labelClass}>Core skills</label>
              <ChipInput values={hotlistForm.coreSkills} onChange={(coreSkills) => setHotlistForm({ ...hotlistForm, coreSkills })} placeholder="Java, Spring Boot, AWS…" />
            </div>
            <div>
              <label className={labelClass}>Contact email *</label>
              <input className={inputClass} type="email" value={hotlistForm.contactEmail} onChange={(e) => setHotlistForm({ ...hotlistForm, contactEmail: e.target.value })} placeholder="you@company.com" />
            </div>

            <button
              type="button"
              onClick={() => setShowMore((v) => !v)}
              className={`inline-flex items-center gap-1 text-[11px] font-semibold ${isDark ? 'text-[#94A3B8] hover:text-slate-300' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {showMore ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              {showMore ? 'Hide more details' : 'Add more details (optional)'}
            </button>

            {showMore && (
              <div className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className={labelClass}>Employment type</label>
                    <input className={inputClass} value={hotlistForm.employmentType} onChange={(e) => setHotlistForm({ ...hotlistForm, employmentType: e.target.value })} placeholder="C2C, W2, 1099" />
                  </div>
                  <div>
                    <label className={labelClass}>Work type</label>
                    <input className={inputClass} value={hotlistForm.workType} onChange={(e) => setHotlistForm({ ...hotlistForm, workType: e.target.value })} placeholder="Remote, Hybrid, Onsite" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className={labelClass}>Rate min ($/hr)</label>
                    <input className={inputClass} inputMode="decimal" value={hotlistForm.hourlyRateMin} onChange={(e) => setHotlistForm({ ...hotlistForm, hourlyRateMin: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Rate max ($/hr)</label>
                    <input className={inputClass} inputMode="decimal" value={hotlistForm.hourlyRateMax} onChange={(e) => setHotlistForm({ ...hotlistForm, hourlyRateMax: e.target.value })} />
                  </div>
                  <div>
                    <label className={labelClass}>Experience (yrs)</label>
                    <input className={inputClass} inputMode="numeric" value={hotlistForm.yearsExperience} onChange={(e) => setHotlistForm({ ...hotlistForm, yearsExperience: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className={labelClass}>Visa type</label>
                  <input className={inputClass} value={hotlistForm.visaType} onChange={(e) => setHotlistForm({ ...hotlistForm, visaType: e.target.value })} placeholder="H1B, GC, USC" />
                </div>
                <div>
                  <label className={labelClass}>Availability</label>
                  <input className={inputClass} value={hotlistForm.availability} onChange={(e) => setHotlistForm({ ...hotlistForm, availability: e.target.value })} placeholder="Immediate, 2 weeks notice" />
                </div>
                <div>
                  <label className={labelClass}>Candidate summary</label>
                  <textarea className={inputClass} rows={4} value={hotlistForm.candidateSummary} onChange={(e) => setHotlistForm({ ...hotlistForm, candidateSummary: e.target.value })} />
                </div>
                <div>
                  <label className={labelClass}>Contact phone</label>
                  <input className={inputClass} value={hotlistForm.contactPhone} onChange={(e) => setHotlistForm({ ...hotlistForm, contactPhone: e.target.value })} />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className={`rounded-md border px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50 ${isDark ? 'border-white/15 text-[#94A3B8] hover:bg-white/5' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            Cancel
          </button>
          <button type="button" onClick={() => void handleSubmit()} disabled={saving || (isMultiCandidateMode && parsedCandidates.length === 0)} className="rounded-md bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? 'Saving…' : isEditing ? 'Save changes' : isMultiCandidateMode ? `Post all ${parsedCandidates.length}` : 'Post'}
          </button>
        </div>
      </div>
    </div>
    <InsufficientCreditsModal
      open={showOutOfCreditsModal}
      onClose={() => setShowOutOfCreditsModal(false)}
      balance={account?.credits_balance ?? 0}
      actionLabel="create this post"
    />
    </>
  );
}
