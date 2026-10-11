// What admin-stats returns: the admin_account_stats SQL function's payload.
// See supabase/migrations/20261011200000_admin_account_stats.sql for how each
// number is counted.

import type { DailyRow } from './admin-signups-series';

export type Role = 'profiles' | 'jobs' | 'job_seeker' | 'none';
export type RoleFilter = 'all' | Exclude<Role, 'none'>;

export const ROLE_LABEL: Record<Role, string> = {
  profiles: 'Profiles',
  jobs: 'Jobs',
  job_seeker: 'Job seeker',
  none: 'No role',
};

export const ROLE_FILTERS: Array<{ key: RoleFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'profiles', label: 'Profiles' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'job_seeker', label: 'Job seeker' },
];

export type TeaserState = 'none' | 'teasers' | 'paused' | 'second_chance';

export interface AccountRow {
  account_id: string;
  name: string | null;
  email: string | null;
  role: Role;
  internal: boolean;
  created_at: string;
  age_days: number;
  last_active: string | null;
  sessions: number;
  active_seconds: number;
  active_days: number;
  gmail_connected: boolean;
  avatar_on: boolean;
  billing_currency: 'INR' | 'USD' | null;
  /** Any paid top-up, ever. */
  paid: boolean;
  revenue_inr: number;
  revenue_usd: number;
  credits_balance: number;
  credits_bought: number;
  credits_spent: number;
  /** Open profiles (or jobs) the account has now. */
  profiles_or_jobs: number;
  matches: number;
  /** Of the matches added in the range, how many have been opened. */
  matches_watched: number;
  watched: number;
  saved: number;
  shared: number;
  not_a_match: number;
  applied_email: number;
  applied_site: number;
  ask_resume: number;
  asks: number;
  replies: number;
  interviews: number;
  placed: number;
  ai_match_runs: number;
  ai_apply_fills: number;
  referrals_made: number;
  referred_by: boolean;
  picture_reports: number;
  emails_received: number;
  teaser_state: TeaserState;
  last_match_at: string | null;
}

export type Totals = Record<
  | 'accounts' | 'signups' | 'active' | 'sessions' | 'active_seconds' | 'gmail_connected' | 'avatars_on'
  | 'with_profiles_or_jobs' | 'profiles_or_jobs' | 'matches' | 'matches_watched' | 'watched' | 'saved' | 'shared'
  | 'not_a_match' | 'applied_email' | 'applied_site' | 'ask_resume' | 'asks' | 'replies' | 'interviews' | 'placed'
  | 'paid_accounts' | 'paid_orders' | 'revenue_inr' | 'revenue_usd' | 'credits_bought' | 'credits_spent'
  | 'ai_match_runs' | 'ai_apply_fills' | 'referrals' | 'referred' | 'picture_reports' | 'emails_received'
  | 'teasers_now' | 'paused_now',
  number
>;

export type EventRow = { event: string; count: number; accounts: number };

export interface AccountStatsPayload {
  accounts: AccountRow[];
  daily: DailyRow[];
  /** Per role and 'all': stage key -> accounts, for signups in the range. */
  funnel: Record<string, Record<string, number>>;
  events: EventRow[];
  /** Per role and 'all'. */
  totals: Record<string, Totals>;
}

/** The payload the pre-RPC admin-stats returned had `stats`, not `accounts`. */
export function isCurrentPayload(data: unknown): data is AccountStatsPayload {
  return typeof data === 'object' && data !== null && Array.isArray((data as { accounts?: unknown }).accounts);
}

export const applied = (row: Pick<AccountRow, 'applied_email' | 'applied_site' | 'ask_resume'>) =>
  (row.applied_email ?? 0) + (row.applied_site ?? 0) + (row.ask_resume ?? 0);

export function totalsFor(totals: Record<string, Totals> | undefined, role: RoleFilter): Partial<Totals> {
  return totals?.[role] ?? {};
}

export function formatInr(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const TEASER_LABEL: Record<TeaserState, string> = {
  none: '-',
  teasers: 'Teasers',
  paused: 'Paused',
  second_chance: 'Second chance',
};
