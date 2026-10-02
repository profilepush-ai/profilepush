import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Briefcase, Clock3, MapPin, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { ensureAccountForUser } from '../lib/account-provisioning';
import { claimMyPublisherProfile, profilePath, publisherInitials, timeAgo } from '../lib/publishers';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';
import SEO from '../components/SEO';

// /profile/<slug>: a publisher's page anyone can open without signing in,
// the page outreach emails link to. Shows who they are and what they posted
// in the last 30 days; never an email, phone or consultant name (the RPC
// leaves those out). Signed-in people get the full in-app profile instead.
//
// ?claimed=1 is where the one-tap claim (claim-profile) lands after signing
// the person in: set up their account (which claims the profile) and take
// them into the app. ?claim=used|expired|removed explains a link that
// couldn't be used.

type PublicJob = {
  id: string;
  title: string | null;
  location: string | null;
  employment_type: string | null;
  rate_min: number | null;
  rate_max: number | null;
  posted_at: string;
};

type PublicHotlist = {
  id: string;
  roles: string[];
  consultant_count: number | null;
  locations: string[];
  posted_at: string;
};

type PublicProfile = {
  slug: string;
  display_name: string;
  company_name: string;
  avatar_url: string;
  is_claimed: boolean;
  follower_count: number;
  job_count: number;
  hotlist_count: number;
  jobs: PublicJob[];
  hotlists: PublicHotlist[];
};

const CLAIM_MESSAGES: Record<string, string> = {
  used: 'That claim link was already used. Sign in with the same email to get to your profile.',
  expired: 'That claim link has expired. Sign up with the email you post from and the profile becomes yours.',
  removed: 'This profile was removed at the owner’s request.',
};

function rateText(min: number | null, max: number | null): string {
  if (min && max && min !== max) return `$${min}–${max}/hr`;
  if (min || max) return `$${min || max}/hr`;
  return '';
}

export default function PublicProfilePage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, account, loading: authLoading, refreshAccount } = useAuth();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [status, setStatus] = useState<'loading' | 'missing' | 'ready'>('loading');
  const claimed = searchParams.get('claimed') === '1';
  const claimReason = searchParams.get('claim') ?? '';

  // Arriving from a claim link (or already signed in): go to the full
  // in-app profile. A brand-new account is set up first, which claims the
  // profile for this confirmed address.
  useEffect(() => {
    if (authLoading || !user) return;
    let cancelled = false;
    void (async () => {
      if (claimed || !account) {
        await ensureAccountForUser(user);
        // Claiming sets the account's user type from the profile (vendor if
        // they post requirements, bench sales if hotlists), so wait for it
        // before loading the account: otherwise they'd still be asked.
        await claimMyPublisherProfile();
        await refreshAccount();
      }
      if (!cancelled) navigate(profilePath(slug, account?.active_persona ?? null), { replace: true });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user?.id, claimed]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase.rpc('get_public_publisher_profile' as never, { p_slug: slug } as never);
      if (cancelled) return;
      if (error || !data) { setStatus('missing'); return; }
      setProfile(data as unknown as PublicProfile);
      setStatus('ready');
    })();
    return () => { cancelled = true; };
  }, [slug]);

  const name = profile ? (profile.display_name.trim() || profile.company_name.trim() || 'Recruiter') : '';
  const signupState = { from: location.pathname };

  if (status === 'loading' || (user && !authLoading)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <LogoSpinner size={20} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {profile && (
        <SEO
          title={`${name}${profile.company_name && profile.company_name !== name ? ` · ${profile.company_name}` : ''} | ProfilePush`}
          description={`${name}'s latest ${profile.job_count > 0 ? 'C2C requirements' : 'bench consultants'} on ProfilePush, the AI copilot for vendors and bench sales recruiters.`}
          canonical={`https://profilepush.ai/profile/${profile.slug}`}
        />
      )}

      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2"><Logo /></Link>
          <div className="flex items-center gap-2">
            <Link to="/signin" state={signupState} className="rounded-lg px-3 py-2 text-[13px] font-semibold text-gray-700 hover:bg-gray-100">Sign in</Link>
            <Link to="/signup" state={signupState} className="rounded-lg bg-blue-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-blue-700">Get started free</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
        {claimReason && CLAIM_MESSAGES[claimReason] && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-900">{CLAIM_MESSAGES[claimReason]}</p>
        )}

        {status === 'missing' || !profile ? (
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-12 text-center">
            <p className="text-[15px] font-semibold text-gray-900">This profile isn&apos;t available</p>
            <p className="mt-1 text-[13px] text-gray-500">It may have been removed, or the link is wrong.</p>
            <Link to="/signup" className="mt-5 inline-block rounded-lg bg-blue-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-blue-700">Explore ProfilePush</Link>
          </div>
        ) : (
          <>
            <section className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-center gap-4">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[20px] font-bold text-blue-700">
                    {publisherInitials(profile)}
                  </div>
                )}
                <div className="min-w-0">
                  <h1 className="truncate text-[20px] font-bold text-gray-900">{name}</h1>
                  {profile.company_name && profile.company_name !== name && (
                    <p className="truncate text-[14px] text-gray-600">{profile.company_name}</p>
                  )}
                  <p className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-gray-500">
                    <span className="inline-flex items-center gap-1"><Users size={12} /> {profile.follower_count} subscriber{profile.follower_count === 1 ? '' : 's'}</span>
                    {profile.job_count > 0 && <span>{profile.job_count} requirement{profile.job_count === 1 ? '' : 's'} this month</span>}
                    {profile.hotlist_count > 0 && <span>{profile.hotlist_count} hotlist{profile.hotlist_count === 1 ? '' : 's'} this month</span>}
                  </p>
                </div>
              </div>
              <Link
                to="/signup"
                state={signupState}
                className="mt-4 flex w-full items-center justify-center rounded-xl bg-blue-600 py-2.5 text-[14px] font-bold text-white hover:bg-blue-700"
              >
                Subscribe to {name.split(' ')[0]}&apos;s new {profile.job_count >= profile.hotlist_count ? 'requirements' : 'consultants'}
              </Link>
            </section>

            {!profile.is_claimed && (
              <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-[14px] font-semibold text-blue-900">Is this you?</p>
                <p className="mt-1 text-[13px] text-blue-900/80">
                  Sign up with the email you post from and this profile is yours: see who subscribes, get matches every morning, and submit in one click.
                </p>
                <Link to="/signup" state={signupState} className="mt-3 inline-block text-[13px] font-bold text-blue-700 hover:underline">Claim this profile →</Link>
              </section>
            )}

            {profile.jobs.length > 0 && (
              <section className="rounded-2xl border border-gray-200 bg-white">
                <h2 className="border-b border-gray-100 px-5 py-3 text-[12px] font-bold uppercase tracking-wide text-gray-500">Recent requirements</h2>
                <ul className="divide-y divide-gray-100">
                  {profile.jobs.map((job) => (
                    <li key={job.id}>
                      <Link to={`/job/${job.id}`} className="block px-5 py-3 hover:bg-gray-50">
                        <p className="text-[14px] font-semibold text-gray-900">{job.title || 'Requirement'}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
                          {job.location && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {job.location}</span>}
                          {job.employment_type && <span className="inline-flex items-center gap-1"><Briefcase size={11} /> {job.employment_type}</span>}
                          {rateText(job.rate_min, job.rate_max) && <span>{rateText(job.rate_min, job.rate_max)}</span>}
                          <span className="inline-flex items-center gap-1"><Clock3 size={11} /> {timeAgo(job.posted_at)}</span>
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {profile.hotlists.length > 0 && (
              <section className="rounded-2xl border border-gray-200 bg-white">
                <h2 className="border-b border-gray-100 px-5 py-3 text-[12px] font-bold uppercase tracking-wide text-gray-500">Recent hotlists</h2>
                <ul className="divide-y divide-gray-100">
                  {profile.hotlists.map((hot) => (
                    <li key={hot.id}>
                      <Link to={`/hotlist/${hot.id}`} className="block px-5 py-3 hover:bg-gray-50">
                        <p className="text-[14px] font-semibold text-gray-900">
                          {hot.roles.length > 0 ? hot.roles.join(', ') : 'Bench hotlist'}
                        </p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-gray-500">
                          {hot.consultant_count && hot.consultant_count > 1 && <span>{hot.consultant_count} consultants</span>}
                          {hot.locations.length > 0 && <span className="inline-flex items-center gap-1"><MapPin size={11} /> {hot.locations.join(', ')}</span>}
                          <span className="inline-flex items-center gap-1"><Clock3 size={11} /> {timeAgo(hot.posted_at)}</span>
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {profile.jobs.length === 0 && profile.hotlists.length === 0 && (
              <p className="rounded-2xl border border-gray-200 bg-white px-5 py-8 text-center text-[13px] text-gray-500">No posts in the last 30 days.</p>
            )}

            <p className="px-1 text-center text-[12px] text-gray-400">
              ProfilePush is the AI copilot for vendors and bench sales recruiters: paste a requirement or hotlist, get ranked matches, and the email writes itself.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
