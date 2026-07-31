import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  CheckCircle2, AlertTriangle, Upload, X,
  User, Briefcase, GraduationCap, Plus, Trash2, Building2,
} from 'lucide-react';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';
import { supabase } from '../lib/supabase';
import { triggerProfileEmbedding } from '../lib/embeddings';
import { normalizeProfileLocationFields } from '../lib/location-normalization';
import type { EducationEntry, ExperienceEntry } from '../types/database';

interface FormData {
  candidate_name: string;
  email: string;
  phone: string;
  target_role: string;
  location: string;
  city: string;
  state: string;
  country: string;
  years_experience: string;
  visa_status: string;
  work_type: string;
  linkedin_url: string;
  github_url: string;
  portfolio_url: string;
  core_skills: string;
  priority_skills: string;
  notice_period: string;
  availability: string;
  desired_salary_min: string;
  desired_salary_max: string;
  preferred_locations: string;
}

const BLANK: FormData = {
  candidate_name: '', email: '', phone: '', target_role: '', location: '',
  city: '', state: '', country: '', years_experience: '', visa_status: '',
  work_type: '', linkedin_url: '', github_url: '', portfolio_url: '',
  core_skills: '', priority_skills: '', notice_period: '', availability: '',
  desired_salary_min: '', desired_salary_max: '', preferred_locations: '',
};

const BLANK_EDU: EducationEntry = { institution: '', degree: '', field: '', start_year: '', end_year: '', gpa: '' };
const BLANK_EXP: ExperienceEntry = { company: '', title: '', location: '', start_date: '', end_date: '', current: false, description: '' };

const VISA_OPTIONS = ['US Citizen', 'Green Card', 'H1B', 'H4 EAD', 'OPT/CPT', 'TN', 'Other'];
const WORK_OPTIONS = ['Remote', 'On-site', 'Hybrid', 'Any'];
const NOTICE_OPTIONS = ['Immediately Available', '1 Week', '2 Weeks', '1 Month', '2 Months'];

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const INPUT = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 bg-white';
const SELECT = INPUT + ' cursor-pointer';

function SectionCard({ icon, title, color, children }: {
  icon: React.ReactNode; title: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <span className={color}>{icon}</span>
        <h2 className="text-sm font-bold text-gray-800">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function CandidateOnboarding() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<'loading' | 'valid' | 'invalid' | 'submitted'>('loading');
  const [accountName, setAccountName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [form, setForm] = useState<FormData>(BLANK);
  const [education, setEducation] = useState<EducationEntry[]>([]);
  const [experience, setExperience] = useState<ExperienceEntry[]>([]);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Partial<FormData>>({});

  useEffect(() => { validateToken(); }, [token]);

  async function validateToken() {
    if (!token) { setStatus('invalid'); return; }
    const { data } = await supabase
      .from('onboarding_tokens')
      .select('account_id, is_active, expires_at, accounts(name)')
      .eq('token', token)
      .maybeSingle();
    if (!data || !data.is_active || new Date(data.expires_at) < new Date()) {
      setStatus('invalid');
      return;
    }
    setAccountId(data.account_id);
    // @ts-ignore — dynamic join
    setAccountName(data.accounts?.name ?? 'the agency');
    setStatus('valid');
  }

  function update(field: keyof FormData, value: string) {
    setForm(f => ({ ...f, [field]: value }));
    setErrors(e => ({ ...e, [field]: undefined }));
  }

  // Education helpers
  function addEdu() { setEducation(prev => [...prev, { ...BLANK_EDU }]); }
  function removeEdu(i: number) { setEducation(prev => prev.filter((_, idx) => idx !== i)); }
  function updateEdu(i: number, field: keyof EducationEntry, value: string) {
    setEducation(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e));
  }

  // Experience helpers
  function addExp() { setExperience(prev => [...prev, { ...BLANK_EXP }]); }
  function removeExp(i: number) { setExperience(prev => prev.filter((_, idx) => idx !== i)); }
  function updateExp(i: number, field: keyof ExperienceEntry, value: string | boolean) {
    setExperience(prev => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e));
  }

  function validate(): boolean {
    const errs: Partial<FormData> = {};
    if (!form.candidate_name.trim()) errs.candidate_name = 'Required';
    if (!form.email.trim())          errs.email = 'Required';
    if (!form.target_role.trim())    errs.target_role = 'Required';
    if (!form.priority_skills.trim()) errs.priority_skills = 'Required';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate() || !accountId) return;
    setSubmitting(true);

    try {
      const rawProfilePayload = {
        account_id: accountId,
        candidate_name: form.candidate_name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        target_role: form.target_role.trim(),
        location: form.location.trim(),
        city: form.city.trim(),
        state: form.state.trim(),
        country: form.country.trim(),
        years_experience: form.years_experience ? Number(form.years_experience) : null,
        visa_status: form.visa_status,
        work_type: form.work_type,
        linkedin_url: form.linkedin_url.trim(),
        github_url: form.github_url.trim(),
        portfolio_url: form.portfolio_url.trim(),
        core_skills: form.core_skills.trim(),
        priority_skills: form.priority_skills.trim(),
        notice_period: form.notice_period,
        availability: form.availability.trim(),
        desired_salary_min: form.desired_salary_min ? Number(form.desired_salary_min) : null,
        desired_salary_max: form.desired_salary_max ? Number(form.desired_salary_max) : null,
        preferred_locations: form.preferred_locations.trim(),
        education,
        experience,
      };
      const normalizedProfilePayload = await normalizeProfileLocationFields(rawProfilePayload);

      const { data: profile, error } = await supabase
        .from('profiles')
        .insert(normalizedProfilePayload)
        .select()
        .single();

      if (error || !profile) throw new Error(error?.message ?? 'Failed to create profile');

      if (resumeFile) {
        const storagePath = `${profile.id}/${Date.now()}-${resumeFile.name}`;
        const { error: uploadErr } = await supabase.storage
          .from('resumes').upload(storagePath, resumeFile, { contentType: resumeFile.type || 'application/octet-stream' });
        if (!uploadErr) {
          const { data: urlData } = supabase.storage.from('resumes').getPublicUrl(storagePath);
          await supabase.from('resume_files').insert({
            profile_id: profile.id, file_name: resumeFile.name,
            file_url: urlData.publicUrl, category: 'resume',
          });
        }
      }

      await supabase.from('activity_logs').insert({
        profile_id: profile.id,
        event_type: 'profile_created',
        description: 'Candidate submitted their own profile via onboarding link',
      });

      triggerProfileEmbedding(profile.id);

      setStatus('submitted');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
    setSubmitting(false);
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <LogoSpinner size={24} />
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={24} className="text-red-400" />
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">Link Expired or Invalid</h1>
          <p className="text-sm text-gray-500">This onboarding link is no longer valid. Please ask your recruiter for a new link.</p>
        </div>
      </div>
    );
  }

  if (status === 'submitted') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-10 max-w-sm text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={28} className="text-emerald-500" />
          </div>
          <h1 className="text-base font-bold text-gray-900 mb-2">Profile Submitted!</h1>
          <p className="text-sm text-gray-500">
            Your profile has been received by <strong>{accountName}</strong>. A recruiter will be in touch shortly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto">

        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 font-bold text-blue-600 text-lg mb-3">
            <Logo size="lg" />
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">Candidate Onboarding</h1>
          <p className="text-sm text-gray-500">
            Submit your profile to <strong>{accountName}</strong>. Fill in as much detail as possible to improve your job matches.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Personal Info */}
          <SectionCard icon={<User size={14} />} title="Personal Information" color="text-blue-500">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Full Name" required>
                <input value={form.candidate_name} onChange={e => update('candidate_name', e.target.value)}
                  className={INPUT + (errors.candidate_name ? ' border-red-300' : '')} placeholder="Jane Smith" />
                {errors.candidate_name && <p className="text-[10px] text-red-500 mt-0.5">{errors.candidate_name}</p>}
              </Field>
              <Field label="Email Address" required>
                <input type="email" value={form.email} onChange={e => update('email', e.target.value)}
                  className={INPUT + (errors.email ? ' border-red-300' : '')} placeholder="jane@example.com" />
                {errors.email && <p className="text-[10px] text-red-500 mt-0.5">{errors.email}</p>}
              </Field>
              <Field label="Phone Number">
                <input value={form.phone} onChange={e => update('phone', e.target.value)}
                  className={INPUT} placeholder="+1 (555) 000-0000" />
              </Field>
              <Field label="LinkedIn URL">
                <input value={form.linkedin_url} onChange={e => update('linkedin_url', e.target.value)}
                  className={INPUT} placeholder="linkedin.com/in/yourprofile" />
              </Field>
              <Field label="GitHub URL">
                <input value={form.github_url} onChange={e => update('github_url', e.target.value)}
                  className={INPUT} placeholder="github.com/yourusername" />
              </Field>
              <Field label="Portfolio URL">
                <input value={form.portfolio_url} onChange={e => update('portfolio_url', e.target.value)}
                  className={INPUT} placeholder="yoursite.com" />
              </Field>
              <Field label="City">
                <input value={form.city} onChange={e => update('city', e.target.value)}
                  className={INPUT} placeholder="Austin" />
              </Field>
              <Field label="State">
                <input value={form.state} onChange={e => update('state', e.target.value)}
                  className={INPUT} placeholder="TX" />
              </Field>
              <Field label="Country">
                <input value={form.country} onChange={e => update('country', e.target.value)}
                  className={INPUT} placeholder="USA" />
              </Field>
              <Field label="Preferred Locations">
                <input value={form.preferred_locations} onChange={e => update('preferred_locations', e.target.value)}
                  className={INPUT} placeholder="Remote, Austin, NYC" />
              </Field>
            </div>
          </SectionCard>

          {/* Job Preferences */}
          <SectionCard icon={<Briefcase size={14} />} title="Job Preferences" color="text-emerald-500">
            <div className="grid grid-cols-2 gap-4">
              <Field label="Target Role" required>
                <input value={form.target_role} onChange={e => update('target_role', e.target.value)}
                  className={INPUT + (errors.target_role ? ' border-red-300' : '')} placeholder="Senior React Developer" />
                {errors.target_role && <p className="text-[10px] text-red-500 mt-0.5">{errors.target_role}</p>}
              </Field>
              <Field label="Years of Experience">
                <input type="number" min="0" max="50" value={form.years_experience} onChange={e => update('years_experience', e.target.value)}
                  className={INPUT} placeholder="5" />
              </Field>
              <Field label="Visa Status">
                <select value={form.visa_status} onChange={e => update('visa_status', e.target.value)} className={SELECT}>
                  <option value="">Select…</option>
                  {VISA_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Work Type Preference">
                <select value={form.work_type} onChange={e => update('work_type', e.target.value)} className={SELECT}>
                  <option value="">Select…</option>
                  {WORK_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Notice Period">
                <select value={form.notice_period} onChange={e => update('notice_period', e.target.value)} className={SELECT}>
                  <option value="">Select…</option>
                  {NOTICE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Availability">
                <input value={form.availability} onChange={e => update('availability', e.target.value)}
                  className={INPUT} placeholder="Available from July 1" />
              </Field>
              <Field label="Expected Salary Min ($/yr)">
                <input type="number" value={form.desired_salary_min} onChange={e => update('desired_salary_min', e.target.value)}
                  className={INPUT} placeholder="80000" />
              </Field>
              <Field label="Expected Salary Max ($/yr)">
                <input type="number" value={form.desired_salary_max} onChange={e => update('desired_salary_max', e.target.value)}
                  className={INPUT} placeholder="120000" />
              </Field>
            </div>
          </SectionCard>

          {/* Skills */}
          <SectionCard icon={<GraduationCap size={14} />} title="Core Skills" color="text-violet-500">
            <Field label="Technical Skills (comma-separated)">
              <textarea rows={3} value={form.core_skills} onChange={e => update('core_skills', e.target.value)}
                className={INPUT + ' resize-none'} placeholder="React, TypeScript, Node.js, AWS, PostgreSQL…" />
            </Field>
            <Field label="Priority Skills (comma-separated, top 5-8 skills to match against) *">
              <textarea rows={2} value={form.priority_skills} onChange={e => update('priority_skills', e.target.value)}
                className={INPUT + ' resize-none'} placeholder="React, TypeScript, AWS, Node.js…" required />
            </Field>
          </SectionCard>

          {/* Education */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GraduationCap size={14} className="text-violet-500" />
                <h2 className="text-sm font-bold text-gray-800">Education</h2>
              </div>
              <button
                type="button" onClick={addEdu}
                className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors border border-blue-100"
              >
                <Plus size={11} /> Add Entry
              </button>
            </div>
            {education.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No education entries yet. Click "Add Entry" to add one.</p>
            ) : (
              <div className="space-y-4">
                {education.map((edu, i) => (
                  <div key={i} className="border border-gray-100 rounded-xl p-4 bg-gray-50/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Entry {i + 1}</span>
                      <button type="button" onClick={() => removeEdu(i)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Institution">
                        <input value={edu.institution} onChange={e => updateEdu(i, 'institution', e.target.value)}
                          className={INPUT} placeholder="MIT" />
                      </Field>
                      <Field label="Degree">
                        <input value={edu.degree} onChange={e => updateEdu(i, 'degree', e.target.value)}
                          className={INPUT} placeholder="Bachelor of Science" />
                      </Field>
                      <Field label="Field of Study">
                        <input value={edu.field ?? ''} onChange={e => updateEdu(i, 'field', e.target.value)}
                          className={INPUT} placeholder="Computer Science" />
                      </Field>
                      <Field label="GPA (optional)">
                        <input value={edu.gpa ?? ''} onChange={e => updateEdu(i, 'gpa', e.target.value)}
                          className={INPUT} placeholder="3.8" />
                      </Field>
                      <Field label="Start Year">
                        <input value={String(edu.start_year ?? '')} onChange={e => updateEdu(i, 'start_year', e.target.value)}
                          className={INPUT} placeholder="2018" />
                      </Field>
                      <Field label="End Year">
                        <input value={String(edu.end_year ?? '')} onChange={e => updateEdu(i, 'end_year', e.target.value)}
                          className={INPUT} placeholder="2022" />
                      </Field>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Experience */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm px-6 py-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building2 size={14} className="text-amber-500" />
                <h2 className="text-sm font-bold text-gray-800">Work Experience</h2>
              </div>
              <button
                type="button" onClick={addExp}
                className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-lg transition-colors border border-blue-100"
              >
                <Plus size={11} /> Add Entry
              </button>
            </div>
            {experience.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No experience entries yet. Click "Add Entry" to add one.</p>
            ) : (
              <div className="space-y-4">
                {experience.map((exp, i) => (
                  <div key={i} className="border border-gray-100 rounded-xl p-4 bg-gray-50/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Entry {i + 1}</span>
                      <button type="button" onClick={() => removeExp(i)} className="text-gray-300 hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Company">
                        <input value={exp.company} onChange={e => updateExp(i, 'company', e.target.value)}
                          className={INPUT} placeholder="Acme Corp" />
                      </Field>
                      <Field label="Title">
                        <input value={exp.title} onChange={e => updateExp(i, 'title', e.target.value)}
                          className={INPUT} placeholder="Senior Engineer" />
                      </Field>
                      <Field label="Location">
                        <input value={exp.location ?? ''} onChange={e => updateExp(i, 'location', e.target.value)}
                          className={INPUT} placeholder="Austin, TX" />
                      </Field>
                      <div className="flex items-end gap-2">
                        <div className="flex-1">
                          <Field label="Start Date">
                            <input value={exp.start_date ?? ''} onChange={e => updateExp(i, 'start_date', e.target.value)}
                              className={INPUT} placeholder="Jan 2020" />
                          </Field>
                        </div>
                      </div>
                      <Field label="End Date">
                        <input value={exp.end_date ?? ''} onChange={e => updateExp(i, 'end_date', e.target.value)}
                          className={INPUT} placeholder="Dec 2023" disabled={!!exp.current} />
                      </Field>
                      <div className="flex items-center gap-2 self-end pb-2">
                        <input
                          type="checkbox" id={`cur-${i}`}
                          checked={!!exp.current}
                          onChange={e => updateExp(i, 'current', e.target.checked)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-400"
                        />
                        <label htmlFor={`cur-${i}`} className="text-xs text-gray-600 cursor-pointer select-none">Currently working here</label>
                      </div>
                    </div>
                    <Field label="Description">
                      <textarea rows={2} value={exp.description ?? ''}
                        onChange={e => updateExp(i, 'description', e.target.value)}
                        className={INPUT + ' resize-none'}
                        placeholder="Key responsibilities and achievements…"
                      />
                    </Field>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Resume Upload */}
          <SectionCard icon={<Upload size={14} />} title="Resume / CV" color="text-gray-500">
            {resumeFile ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
                <span className="text-xs text-emerald-700 font-medium flex-1 truncate">{resumeFile.name}</span>
                <button type="button" onClick={() => setResumeFile(null)} className="text-gray-400 hover:text-red-500">
                  <X size={13} />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-3 border border-dashed border-gray-200 rounded-xl px-4 py-3 cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-colors">
                <Upload size={14} className="text-gray-400 shrink-0" />
                <div>
                  <p className="text-xs text-gray-600 font-medium">Upload your resume (optional)</p>
                  <p className="text-[11px] text-gray-400">PDF, Word, RTF, TXT supported</p>
                </div>
                <input type="file" accept=".pdf,.doc,.docx,.txt" className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) setResumeFile(f); }} />
              </label>
            )}
          </SectionCard>

          <button
            type="submit" disabled={submitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold text-sm px-6 py-3.5 rounded-xl flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-900/20"
          >
            {submitting && <LogoSpinner size={15} />}
            {submitting ? 'Submitting…' : 'Submit My Profile'}
          </button>

          <p className="text-center text-[11px] text-gray-400 pb-6">
            Your information is securely stored and only accessible by <strong>{accountName}</strong>.
          </p>
        </form>
      </div>
    </div>
  );
}
