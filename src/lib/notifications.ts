import { supabase } from './supabase';

export const NOTIFICATION_TYPES = {
  // Pipeline
  candidate_added:       { label: 'Candidate Added',       group: 'Pipeline', description: 'When a new candidate profile is added to the bench' },
  job_matches_found:     { label: 'Job Matches Found',      group: 'Pipeline', description: 'When AI finds new job matches for a candidate' },
  submission_added:      { label: 'Submission Logged',      group: 'Pipeline', description: 'When a new job submission is recorded' },
  submission_confirmed:  { label: 'Candidate Confirmed',    group: 'Pipeline', description: 'When a candidate confirms they have applied' },
  // AI
  resume_rewritten:      { label: 'Resume Rewritten',       group: 'AI',       description: 'When an AI resume rewrite completes successfully' },
  job_score_complete:    { label: 'Job Score Ready',         group: 'AI',       description: 'When AI job match scoring finishes for a candidate' },
  // Usage
  credits_low:           { label: 'Credits Low',             group: 'Usage',    description: 'When AI credit balance drops below $1.00' },
  credits_depleted:      { label: 'Credits Depleted',        group: 'Usage',    description: 'When AI credits are fully exhausted' },
  // Team
  team_member_joined:    { label: 'Member Joined',           group: 'Team',     description: 'When a team member joins the workspace' },
  team_invite_accepted:  { label: 'Invite Accepted',         group: 'Team',     description: 'When a team invite is accepted by the recipient' },
  // Billing
  plan_renewed:          { label: 'Plan Renewed',            group: 'Billing',  description: 'When the subscription renews successfully' },
  plan_expiring:         { label: 'Plan Expiring Soon',      group: 'Billing',  description: 'When the subscription is within 7 days of expiry' },
  // Reports
  weekly_summary:        { label: 'Weekly Digest',           group: 'Reports',  description: 'Weekly summary of activity and output' },
} as const;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export const NOTIFICATION_GROUPS = ['Pipeline', 'AI', 'Usage', 'Team', 'Billing', 'Reports'] as const;

export type NotificationPreference = {
  notif_type: NotificationType;
  in_app_enabled: boolean;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
};

export type AppNotification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  read: boolean;
  created_at: string;
};

export async function sendNotification(params: {
  userId: string;
  accountId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
}) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification`;
  const { data: { session } } = await supabase.auth.getSession();
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      user_id: params.userId,
      account_id: params.accountId,
      type: params.type,
      title: params.title,
      body: params.body,
      link: params.link,
    }),
  });
}
