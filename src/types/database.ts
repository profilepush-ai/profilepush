export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface EducationEntry {
  institution: string;
  degree: string;
  field: string;
  start_year: string;
  end_year: string;
  gpa?: string;
}

export interface ExperienceEntry {
  company: string;
  title: string;
  location: string;
  start_date: string;
  end_date: string;
  current: boolean;
  description: string;
}

export interface Database {
  public: {
    Tables: {
      linkedin_groups: {
        Row: {
          group_id: string;
          group_name: string | null;
          is_active: boolean;
          last_scraped_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          group_id: string;
          group_name?: string | null;
          is_active?: boolean;
          last_scraped_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          group_id?: string;
          group_name?: string | null;
          is_active?: boolean;
          last_scraped_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      profiles: {
        Row: {
          id: string;
          candidate_name: string;
          target_role: string;
          location: string;
          core_skills: string;
          created_at: string;
          // Contact
          phone: string;
          email: string;
          linkedin_url: string;
          github_url: string;
          portfolio_url: string;
          city: string;
          state: string;
          zip_code: string;
          country: string;
          // Preferences
          desired_salary_min: number | null;
          desired_salary_max: number | null;
          work_type: string;
          preferred_locations: string;
          notice_period: string;
          visa_status: string;
          years_experience: number | null;
          availability: string;
          assigned_to: string | null;
          profile_status: 'Active' | 'Placed' | 'Lost';
          bench_stage: 'New' | 'Assigned' | 'Sourcing' | 'Submitted' | 'Placed' | 'Lost';
          priority_skills: string;
          // Structured
          education: EducationEntry[];
          experience: ExperienceEntry[];
        };
        Insert: {
          id?: string;
          candidate_name: string;
          target_role: string;
          location?: string;
          core_skills?: string;
          created_at?: string;
          phone?: string;
          email?: string;
          linkedin_url?: string;
          github_url?: string;
          portfolio_url?: string;
          city?: string;
          state?: string;
          zip_code?: string;
          country?: string;
          desired_salary_min?: number | null;
          desired_salary_max?: number | null;
          work_type?: string;
          preferred_locations?: string;
          notice_period?: string;
          visa_status?: string;
          years_experience?: number | null;
          availability?: string;
          assigned_to?: string | null;
          profile_status?: 'Active' | 'Placed' | 'Lost';
          bench_stage?: 'New' | 'Assigned' | 'Sourcing' | 'Submitted' | 'Placed' | 'Lost';
          priority_skills?: string;
          education?: EducationEntry[];
          experience?: ExperienceEntry[];
        };
        Update: {
          id?: string;
          candidate_name?: string;
          target_role?: string;
          location?: string;
          core_skills?: string;
          created_at?: string;
          phone?: string;
          email?: string;
          linkedin_url?: string;
          github_url?: string;
          portfolio_url?: string;
          city?: string;
          state?: string;
          zip_code?: string;
          country?: string;
          desired_salary_min?: number | null;
          desired_salary_max?: number | null;
          work_type?: string;
          preferred_locations?: string;
          notice_period?: string;
          visa_status?: string;
          years_experience?: number | null;
          availability?: string;
          assigned_to?: string | null;
          profile_status?: 'Active' | 'Placed' | 'Lost';
          bench_stage?: 'New' | 'Assigned' | 'Sourcing' | 'Submitted' | 'Placed' | 'Lost';
          priority_skills?: string;
          education?: EducationEntry[];
          experience?: ExperienceEntry[];
        };
      };
      resume_files: {
        Row: {
          id: string;
          profile_id: string;
          file_name: string;
          file_url: string | null;
          category: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          file_name: string;
          file_url?: string | null;
          category?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          file_name?: string;
          file_url?: string | null;
          category?: string;
          created_at?: string;
        };
      };
      wishlisted_jobs: {
        Row: {
          id: string;
          profile_id: string;
          job_title: string;
          company: string;
          board: string;
          location: string;
          job_url: string | null;
          status: string;
          created_at: string;
          source_job_id: string | null;
          rewrite_job_id: string | null;
          rewrite_file_url: string | null;
          rewrite_file_name: string | null;
        };
        Insert: {
          id?: string;
          profile_id: string;
          job_title: string;
          company: string;
          board?: string;
          location?: string;
          job_url?: string | null;
          status?: string;
          created_at?: string;
          source_job_id?: string | null;
          rewrite_job_id?: string | null;
          rewrite_file_url?: string | null;
          rewrite_file_name?: string | null;
        };
        Update: {
          id?: string;
          profile_id?: string;
          job_title?: string;
          company?: string;
          board?: string;
          location?: string;
          job_url?: string | null;
          status?: string;
          created_at?: string;
          source_job_id?: string | null;
          rewrite_job_id?: string | null;
          rewrite_file_url?: string | null;
          rewrite_file_name?: string | null;
        };
      };
      activity_logs: {
        Row: {
          id: string;
          profile_id: string;
          event_type: string;
          description: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          profile_id: string;
          event_type: string;
          description: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          profile_id?: string;
          event_type?: string;
          description?: string;
          created_at?: string;
        };
      };
    };
    Functions: {
      track_user_activity: {
        Args: { p_auth_session_id: string };
        Returns: undefined;
      };
    };
  };
}

export interface Submission {
  id: string;
  account_id: string | null;
  candidate_name: string;
  skill_set: string;
  vendor_name: string;
  vendor_email: string;
  vendor_contact: string;
  client_name: string;
  job_location: string;
  rate: string;
  submitted_by: string;
  submission_date: string;
  submission_type: string;
  created_at: string;
}

export type Profile = Database['public']['Tables']['profiles']['Row'];
export type ResumeFile = Database['public']['Tables']['resume_files']['Row'];
export type WishlistedJob = Database['public']['Tables']['wishlisted_jobs']['Row'];
export type ActivityLog = Database['public']['Tables']['activity_logs']['Row'];

export interface ProfileAssignment {
  id: string;
  profile_id: string;
  user_id: string;
  created_at: string;
}

export interface Account {
  id: string;
  name: string;
  owner_id: string;
  created_at: string;
}

export interface AccountMember {
  id: string;
  account_id: string;
  user_id: string | null;
  invited_email: string;
  role: 'owner' | 'admin' | 'member';
  status: 'active' | 'invited';
  created_at: string;
}
