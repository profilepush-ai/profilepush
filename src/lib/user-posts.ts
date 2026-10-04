import { supabase } from './supabase';
import type { UserPost } from '../components/posts/PostFormModal';

// A user's own posts (requirements and hotlists) in the shape the post form
// edits: loading by id, open / close and delete. Shared by My Posts and the
// Tracker's column menu so both behave the same.

export const USER_JOB_POST_COLUMNS = 'id, job_title, company_name, location, employment_type, seniority_level, salary_range, job_description, post_content, extracted_skills, extracted_experience_years, extracted_visa_types, extracted_hourly_rate_min, extracted_hourly_rate_max, poster_email, poster_phone, post_status, created_at';
export const USER_HOTLIST_POST_COLUMNS = 'id, role_title, candidate_name, core_skills, years_experience, visa_type, employment_type, work_type, locations, hourly_rate_min, hourly_rate_max, availability, candidate_summary, raw_post_content, bench_sales_recruiter_email, bench_sales_recruiter_phone, post_status, created_at';

export type UserJobPostRow = {
  id: string; job_title: string | null; company_name: string | null; location: string | null;
  employment_type: string | null; seniority_level: string | null; salary_range: string | null;
  job_description: string | null; post_content: string | null; extracted_skills: string[] | null;
  extracted_experience_years: number | null; extracted_visa_types: string[] | null;
  extracted_hourly_rate_min: number | null; extracted_hourly_rate_max: number | null;
  poster_email: string | null; poster_phone: string | null; post_status: string | null; created_at: string;
};

export type UserHotlistPostRow = {
  id: string; role_title: string | null; candidate_name: string | null; core_skills: string[] | null;
  years_experience: number | null; visa_type: string | null; employment_type: string | null; work_type: string | null;
  locations: string[] | null; hourly_rate_min: number | null; hourly_rate_max: number | null;
  availability: string | null; candidate_summary: string | null; raw_post_content: string | null;
  bench_sales_recruiter_email: string | null; bench_sales_recruiter_phone: string | null;
  post_status: string | null; created_at: string;
};

export function jobRowToUserPost(row: UserJobPostRow): UserPost {
  return {
    id: row.id,
    kind: 'job',
    title: row.job_title ?? '',
    company: row.company_name ?? '',
    location: row.location ?? '',
    employmentType: row.employment_type ?? '',
    seniorityLevel: row.seniority_level ?? '',
    salaryRange: row.salary_range ?? '',
    jobDescription: row.job_description ?? '',
    postContent: row.post_content ?? '',
    skills: Array.isArray(row.extracted_skills) ? row.extracted_skills : [],
    experienceYears: row.extracted_experience_years ?? null,
    visaTypes: Array.isArray(row.extracted_visa_types) ? row.extracted_visa_types : [],
    hourlyRateMin: row.extracted_hourly_rate_min ?? null,
    hourlyRateMax: row.extracted_hourly_rate_max ?? null,
    contactEmail: row.poster_email ?? '',
    contactPhone: row.poster_phone ?? '',
    candidateName: '',
    visaType: '',
    workType: '',
    locations: [],
    availability: '',
    candidateSummary: '',
    postStatus: (row.post_status as 'open' | 'closed') ?? 'open',
    createdAt: row.created_at,
  };
}

export function hotlistRowToUserPost(row: UserHotlistPostRow): UserPost {
  return {
    id: row.id,
    kind: 'hotlist',
    title: row.role_title ?? '',
    company: '',
    location: '',
    employmentType: row.employment_type ?? '',
    seniorityLevel: '',
    salaryRange: '',
    jobDescription: '',
    postContent: row.raw_post_content ?? '',
    skills: Array.isArray(row.core_skills) ? row.core_skills : [],
    experienceYears: row.years_experience ?? null,
    visaTypes: [],
    hourlyRateMin: row.hourly_rate_min ?? null,
    hourlyRateMax: row.hourly_rate_max ?? null,
    contactEmail: row.bench_sales_recruiter_email ?? '',
    contactPhone: row.bench_sales_recruiter_phone ?? '',
    candidateName: row.candidate_name ?? '',
    visaType: row.visa_type ?? '',
    workType: row.work_type ?? '',
    locations: Array.isArray(row.locations) ? row.locations : [],
    availability: row.availability ?? '',
    candidateSummary: row.candidate_summary ?? '',
    postStatus: (row.post_status as 'open' | 'closed') ?? 'open',
    createdAt: row.created_at,
  };
}

export async function loadUserPost(kind: 'job' | 'hotlist', id: string): Promise<UserPost | null> {
  if (kind === 'job') {
    const { data } = await supabase.from('social_jobs').select(USER_JOB_POST_COLUMNS).eq('id', id).maybeSingle();
    return data ? jobRowToUserPost(data as unknown as UserJobPostRow) : null;
  }
  const { data } = await supabase.from('social_hotlist').select(USER_HOTLIST_POST_COLUMNS).eq('id', id).maybeSingle();
  return data ? hotlistRowToUserPost(data as unknown as UserHotlistPostRow) : null;
}

/** Opens or closes a post (the update RPCs take the whole post). */
export async function setUserPostStatus(post: UserPost, status: 'open' | 'closed') {
  const rpcName = post.kind === 'job' ? 'update_user_job_post' : 'update_user_hotlist_post';
  const args = post.kind === 'job'
    ? {
      p_id: post.id, p_job_title: post.title, p_company_name: post.company, p_location: post.location,
      p_employment_type: post.employmentType, p_seniority_level: post.seniorityLevel, p_salary_range: post.salaryRange,
      p_job_description: post.jobDescription, p_post_content: post.postContent, p_skills: post.skills,
      p_experience_years: post.experienceYears, p_visa_types: post.visaTypes, p_hourly_rate_min: post.hourlyRateMin,
      p_hourly_rate_max: post.hourlyRateMax, p_contact_email: post.contactEmail, p_contact_phone: post.contactPhone,
      p_post_status: status,
    }
    : {
      p_id: post.id, p_role_title: post.title, p_candidate_name: post.candidateName, p_core_skills: post.skills,
      p_years_experience: post.experienceYears, p_visa_type: post.visaType, p_employment_type: post.employmentType,
      p_work_type: post.workType, p_locations: post.locations, p_hourly_rate_min: post.hourlyRateMin,
      p_hourly_rate_max: post.hourlyRateMax, p_availability: post.availability, p_candidate_summary: post.candidateSummary,
      p_post_content: post.postContent, p_contact_email: post.contactEmail, p_contact_phone: post.contactPhone,
      p_post_status: status,
    };
  return supabase.rpc(rpcName as never, args as never);
}

export async function deleteUserPost(post: UserPost) {
  const rpcName = post.kind === 'job' ? 'delete_user_job_post' : 'delete_user_hotlist_post';
  return supabase.rpc(rpcName as never, { p_id: post.id } as never);
}
