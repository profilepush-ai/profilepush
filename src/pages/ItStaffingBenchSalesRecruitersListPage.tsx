import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Logo from '../components/Logo';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import ActiveListTable, { type ActiveListContact } from '../components/ActiveListTable';
import SignInPromptModal from '../components/SignInPromptModal';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { downloadCsv } from '../lib/csv';

const WORKER_URL = (import.meta.env.VITE_ACTIVE_LIST_WORKER_URL ?? '').trim();
const WORKER_TOKEN = (import.meta.env.VITE_ACTIVE_LIST_WORKER_TOKEN ?? '').trim();
const PAGE_PATH = '/it-staffing-bench-sales-recruiters-list';

function monthYear() {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

export default function ItStaffingBenchSalesRecruitersListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<ActiveListContact[]>([]);
  const [refreshedAt, setRefreshedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSignIn, setShowSignIn] = useState(false);

  const title = useMemo(() => `IT Staffing Bench Sales Recruiters List (${monthYear()})`, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!WORKER_URL) {
        setError('The live list is temporarily unavailable.');
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(`${WORKER_URL.replace(/\/$/, '')}/recruiters`, {
          headers: WORKER_TOKEN ? { Authorization: `Bearer ${WORKER_TOKEN}` } : {},
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const payload = await response.json();
        if (cancelled) return;
        setRows(Array.isArray(payload.rows) ? payload.rows : []);
        setRefreshedAt(payload.refreshed_at ?? '');
      } catch {
        if (!cancelled) setError('Could not load the live list right now — please try again shortly.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function performDownload() {
    const { data, error: invokeError } = await supabase.functions.invoke<{ recruiters: ActiveListContact[] }>('active-list');
    if (invokeError || !data) return;
    downloadCsv(
      'it-staffing-bench-sales-recruiters-list.csv',
      ['Name', 'Email', 'Last Active On', 'Role Titles'],
      data.recruiters.map((row) => [row.name, row.email, row.last_active_at, row.role_titles]),
    );
  }

  function handleDownload() {
    if (!user) {
      setShowSignIn(true);
      return;
    }
    void performDownload();
  }

  return (
    <div className="min-h-screen bg-white">
      <SEO
        title={`${title} | ProfilePush`}
        description={`A live, ${monthYear()} list of IT staffing bench sales recruiters actively posting available consultants. See the 100 most recently active free, or log in to download the full list.`}
        canonical={`https://profilepush.ai${PAGE_PATH}`}
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'Dataset',
          name: title,
          description: 'A daily-refreshed directory of IT staffing bench sales recruiters actively posting available consultants, compiled from live market activity.',
          temporalCoverage: new Date().toISOString().slice(0, 7),
          creator: { '@type': 'Organization', name: 'ProfilePush', url: 'https://profilepush.ai' },
        }}
      />
      <nav className="sticky top-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link to="/"><Logo size="md" /></Link>
          <div className="flex items-center gap-3">
            <Link to="/signin" className="hidden text-sm text-gray-500 transition-colors hover:text-gray-900 sm:block">Sign In</Link>
            <Link to="/signup" className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700">
              Start Free <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </nav>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
        <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">{title}</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          Below are the bench sales recruiters our system has seen most recently posting available consultants — sourced from live market activity rather than a static directory that goes stale within weeks. Emails are masked in this free preview; if you're a recruiter looking for consultants to submit against your open requirements, this is who's actively marketing candidates right now.
        </p>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          The 100 most recently active recruiters are shown below at no cost. <a href="/signup" className="font-semibold text-blue-600 hover:underline">Create a free ProfilePush account</a> to download the complete list with unmasked emails, plus daily digest emails as new consultants go active.
        </p>

        {refreshedAt && (
          <p className="mt-4 text-xs font-medium text-gray-400">Last updated: {formatTimestamp(refreshedAt)}</p>
        )}

        <div className="mt-3">
          {error ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">{error}</div>
          ) : (
            <ActiveListTable
              tabs={[{ key: 'recruiters', label: 'Recruiters', rows }]}
              activeTab="recruiters"
              onDownload={handleDownload}
              downloadLabel={user ? 'Download full CSV' : 'Log in to download full list'}
              loading={loading}
              maskPii
            />
          )}
        </div>

        <section className="mt-10">
          <h2 className="text-lg font-bold text-gray-900">Frequently asked questions</h2>
          <div className="mt-4 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">How often is this recruiter list updated?</h3>
              <p className="mt-1 text-sm leading-6 text-gray-600">The underlying data refreshes continuously as our system observes new consultant postings, and this page's cache updates hourly so what you see stays current.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">What counts as "active"?</h3>
              <p className="mt-1 text-sm leading-6 text-gray-600">A recruiter is active if they've posted a consultant listing in the past week. The list is sorted by most recently active first, and this free preview shows the top 100.</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-800">Is the full list free?</h3>
              <p className="mt-1 text-sm leading-6 text-gray-600">The 100 most recently active recruiters are shown here for free, with emails masked. Signing in to ProfilePush unlocks the complete, unmasked list as a downloadable CSV, plus the same view for vendor contacts on our <a href="/it-staffing-vendor-list" className="font-semibold text-blue-600 hover:underline">vendor list</a>.</p>
            </div>
          </div>
        </section>
      </div>
      <SiteFooter />
      <SignInPromptModal
        open={showSignIn}
        onClose={() => setShowSignIn(false)}
        onSuccess={() => { setShowSignIn(false); navigate('/active-list?tab=recruiters'); }}
        message="Sign in to download the full recruiters list."
        signInPath={PAGE_PATH}
      />
    </div>
  );
}
