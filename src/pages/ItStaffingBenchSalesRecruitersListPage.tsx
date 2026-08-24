import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Logo from '../components/Logo';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import { type ActiveListContact } from '../components/ActiveListTable';
import GatedPreviewTable from '../components/GatedPreviewTable';
import SignInPromptModal from '../components/SignInPromptModal';
import Toast from '../components/Toast';
import ContentSection from '../components/ContentSection';
import FaqAccordion, { type FaqEntry } from '../components/FaqAccordion';
import GlossaryList, { type GlossaryTerm } from '../components/GlossaryList';
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

const PLACEMENT_CHAIN_ROWS: { layer: string; who: string; meaning: string }[] = [
  { layer: 'Consultant', who: 'The person being marketed and placed.', meaning: 'Their bench sales recruiter represents them throughout.' },
  { layer: 'Bench Sales Recruiter', who: "Markets the consultant's profile to vendors.", meaning: 'Builds and sends the hotlist — the primary contact this page surfaces.' },
  { layer: 'Sub-vendor / Tier 2 Vendor', who: 'Receives the submission, may pass it up the chain.', meaning: 'One or more layers between the recruiter and the client.' },
  { layer: 'Prime Vendor', who: 'Holds the direct contract with the client or MSP.', meaning: 'Submits the final shortlist to the client.' },
  { layer: 'End Client', who: 'The company with the actual open position.', meaning: 'Makes the final hiring decision.' },
];

const RECRUITER_GLOSSARY: GlossaryTerm[] = [
  { term: 'Bench Sales', definition: 'Marketing consultants who are between projects to vendors and clients to secure their next C2C placement.' },
  { term: 'Hotlist', definition: "A recruiter's running list of available consultants — skills, rate, visa status, location, and availability — sent to vendors with open requirements." },
  { term: 'C2C (Corp-to-Corp)', definition: 'An engagement where one company invoices another for a consultant\'s services, rather than the consultant being a direct employee of either.' },
  { term: 'W2', definition: 'An employment arrangement where the consultant is a direct employee, with taxes withheld from pay.' },
  { term: '1099', definition: 'An independent-contractor arrangement where the consultant is paid without tax withholding.' },
  { term: 'OPT (Optional Practical Training)', definition: 'A temporary work authorization for international students on an F-1 visa, typically valid for 12 months (longer for STEM degrees).' },
  { term: 'CPT (Curricular Practical Training)', definition: 'Work authorization for F-1 students tied to a required or credit-bearing part of their academic program, used while still enrolled.' },
  { term: 'H1B', definition: 'A US work visa sponsored by an employer for specialty-occupation roles, commonly held by consultants who need employer sponsorship to work.' },
  { term: 'GC (Green Card)', definition: 'Lawful permanent resident status — no visa sponsorship or renewal required to work.' },
  { term: 'USC', definition: 'US citizen — no work-authorization restrictions apply.' },
  { term: 'Prime Vendor', definition: "A vendor with a direct staffing contract with the end client or its MSP." },
  { term: 'Resume Masking', definition: "Removing or altering identifying details from a consultant's resume before submission, to prevent it from being shopped around or submitted more than once without the recruiter's knowledge." },
];

const RECRUITER_FAQS: FaqEntry[] = [
  { q: 'What is bench sales in IT staffing?', a: 'Bench sales is the practice of marketing IT consultants who are between projects — "on the bench" — to vendors and clients to secure their next corp-to-corp placement.' },
  { q: 'What is a hotlist?', a: "A hotlist is a bench sales recruiter's running list of available consultants, typically including their skills, rate, visa status, location, and availability, sent to vendors with open requirements." },
  { q: 'What does it mean for a consultant to be "on the bench"?', a: "It means the consultant is currently between projects — not actively billing on a client engagement — while their recruiter markets them for their next placement." },
  { q: "What's the difference between a bench sales recruiter and an account manager?", a: 'A bench sales recruiter represents consultants, marketing them to find a placement. An account manager represents the client or vendor relationship, managing the open requirements that need filling. They work the same deal from opposite ends.' },
  { q: 'How often is this bench sales recruiters list updated?', a: 'The underlying data refreshes continuously from live posting activity, and this page\'s cache refreshes hourly — the "Last updated" timestamp above reflects data that\'s at most an hour old.' },
  { q: 'What information does a typical hotlist include?', a: 'Rate, visa status, location, availability (remote/onsite/hybrid and start date), and core skills — the five things a vendor needs to quickly judge fit.' },
  { q: 'What do OPT, CPT, H1B, GC, and USC mean on a hotlist?', a: "They're work-authorization categories: OPT and CPT are temporary authorizations tied to F-1 student status, H1B is employer-sponsored specialty-occupation status, GC means green card (permanent resident), and USC means US citizen. Many requirements only accept certain categories, so this is usually the first filter a vendor applies." },
  { q: "What's the difference between W2, C2C, and 1099 in bench sales?", a: 'W2 means the consultant is a direct employee with taxes withheld. C2C means one company invoices another for the consultant\'s services. 1099 means the consultant is an independent contractor paid without withholding. A hotlist entry usually states which of these the consultant is open to.' },
  { q: 'What is a Prime Vendor?', a: 'A vendor with a direct staffing contract with the end client or its MSP — the fewest steps between a submission and the client.' },
  { q: 'How do bench sales recruiters find requirements for their consultants?', a: 'Primarily through vendor relationships built over time, plus vendor lists and portals like our companion vendor list that surface who\'s actively posting requirements right now.' },
  { q: 'How many submissions should a bench sales recruiter make per day?', a: 'It varies by recruiter and how many consultants they represent, but the more consistent pattern among recruiters who place quickly is fewer, better-targeted submissions over a high volume of generic ones.' },
  { q: 'What is resume masking, and why do bench sales recruiters use it?', a: "It's removing or altering identifying details from a consultant's resume before submission — done to prevent the same profile from being shopped around or submitted multiple times to the same client without the recruiter's knowledge." },
  { q: 'How is bench sales recruiting different from regular IT recruiting?', a: 'Regular recruiting starts from an open requirement and searches for a matching candidate. Bench sales starts from an available consultant and searches for a matching requirement — the direction of the search is reversed.' },
  { q: 'Can US citizens or green card holders be marketed on a hotlist?', a: 'Yes — hotlists cover every visa/work-authorization status, not just consultants needing sponsorship. USC and GC consultants are often the easiest to place since they remove a filtering step for the vendor.' },
  { q: "How do vendors verify a submitted consultant's visa status?", a: 'Typically through the documentation a recruiter provides at submission (visa/EAD copies) and, for sponsored categories, direct confirmation with the consultant or their petitioning employer.' },
  { q: 'What skills are most commonly marketed on IT hotlists?', a: 'Java and full-stack development, .NET, data engineering, QA/testing, SAP, DevOps/cloud, mainframe, and business/systems analysis show up consistently, though hotlists span the full range of US IT staffing demand.' },
  { q: 'What makes a hotlist submission get a faster response from vendors?', a: 'Leading with the details a vendor actually needs to judge fit — skills, rate, visa status, and availability — instead of making them ask follow-up questions before they can even consider the candidate.' },
  { q: 'How do bench sales recruiters build relationships with prime vendors?', a: "Mostly the same way any B2B relationship is built: consistent, accurate submissions over time, fast response to requirements, and honesty about a consultant's fit rather than submitting everyone for everything." },
  { q: "What's the difference between onsite, remote, and hybrid availability on a hotlist?", a: "Onsite means the consultant works from the client's location, remote means they work from anywhere, and hybrid means some mix of both — usually a set number of days on-site per week. Stating this clearly upfront avoids submissions that get rejected purely on location fit." },
  { q: 'Is bench sales a legitimate business practice in US IT staffing?', a: "Yes — it's a standard, widely used model across the US IT staffing industry for placing consultants between projects, and a large share of C2C hiring runs through bench sales recruiters and the vendors they work with." },
  { q: 'How do I contact a recruiter listed here directly?', a: 'The free preview shows real names and emails for the 10 most recently active recruiters — sign in to a free ProfilePush account to see and download contacts beyond those 10.' },
  { q: "What's the difference between a hotlist and a vendor list?", a: 'A hotlist is recruiters marketing available consultants; a vendor list is vendors marketing open requirements. This page shows hotlist activity — recruiters — while our companion vendor list shows the requirement side.' },
  { q: 'Does this page only cover US IT staffing?', a: "Yes — the underlying data is scoped to US corp-to-corp IT staffing activity, the same market ProfilePush's core matching product is built for." },
  { q: 'Can I trust the contact information on this list?', a: 'Every contact is a real name and email pulled directly from a public hotlist post, not inferred or purchased from a third-party database — accuracy depends only on how recently they posted.' },
];

export default function ItStaffingBenchSalesRecruitersListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<ActiveListContact[]>([]);
  const [refreshedAt, setRefreshedAt] = useState('');
  const [totalCount30d, setTotalCount30d] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSignIn, setShowSignIn] = useState(false);
  const [downloadToast, setDownloadToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const title = useMemo(() => `IT Staffing Bench Sales Recruiters List (${monthYear()})`, []);
  const canonicalUrl = `https://profilepush.ai${PAGE_PATH}`;

  const jsonLd = useMemo(() => {
    const distinctRoleTitles = Array.from(
      new Set(
        rows.flatMap((row) => (row.role_titles_list?.length ? row.role_titles_list : row.role_titles ? [row.role_titles] : [])),
      ),
    ).slice(0, 25);

    const thirtyDaysAgoIso = refreshedAt && !Number.isNaN(new Date(refreshedAt).getTime())
      ? new Date(new Date(refreshedAt).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
      : undefined;

    const countSentence = totalCount30d != null
      ? ` ${totalCount30d.toLocaleString('en-US')} recruiters have been active in the last 30 days.`
      : '';

    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          name: title,
          description: `A live, continuously-refreshed list of IT staffing bench sales recruiters actively posting consultant hotlists.${countSentence}`,
          url: canonicalUrl,
          publisher: { '@id': 'https://profilepush.ai/#organization' },
        },
        {
          '@type': 'Dataset',
          name: title,
          description: `A live directory of IT staffing bench sales recruiters actively posting consultant/hotlist listings, compiled from continuously scraped market activity and refreshed hourly.${countSentence}`,
          url: canonicalUrl,
          creator: { '@id': 'https://profilepush.ai/#organization' },
          dateModified: refreshedAt || undefined,
          temporalCoverage: thirtyDaysAgoIso && refreshedAt ? `${thirtyDaysAgoIso}/${refreshedAt}` : undefined,
          additionalProperty: totalCount30d != null
            ? [{ '@type': 'PropertyValue', name: 'activeContactCount30d', value: totalCount30d }]
            : undefined,
        },
        distinctRoleTitles.length > 0
          ? {
              '@type': 'ItemList',
              name: `Example role titles seen in the ${title}`,
              numberOfItems: distinctRoleTitles.length,
              itemListElement: distinctRoleTitles.map((roleTitle, index) => ({ '@type': 'ListItem', position: index + 1, name: roleTitle })),
            }
          : undefined,
        { '@type': 'FAQPage', mainEntity: RECRUITER_FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
        { '@type': 'DefinedTermSet', name: `${title} glossary`, hasDefinedTerm: RECRUITER_GLOSSARY.map((t) => ({ '@type': 'DefinedTerm', name: t.term, description: t.definition })) },
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://profilepush.ai/' },
            { '@type': 'ListItem', position: 2, name: title, item: canonicalUrl },
          ],
        },
      ].filter(Boolean),
    };
  }, [rows, refreshedAt, totalCount30d, title, canonicalUrl]);

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
        setTotalCount30d(typeof payload.total_count_30d === 'number' ? payload.total_count_30d : null);
      } catch {
        if (!cancelled) setError('Could not load the live list right now — please try again shortly.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function performDownload() {
    const { data, error: invokeError } = await supabase.functions.invoke<{ recruiters: ActiveListContact[]; limited?: boolean; message?: string }>(
      'active-list',
      { body: { hours_back: 720, download_type: 'recruiters' } },
    );
    if (invokeError || !data) {
      setDownloadToast({ message: 'Could not download the list right now — please try again shortly.', type: 'error' });
      return;
    }
    if (data.recruiters.length === 0) {
      setDownloadToast({ message: data.message || "You've reached the free plan's download limit. Upgrade for unlimited downloads.", type: 'error' });
      return;
    }
    downloadCsv(
      'it-staffing-bench-sales-recruiters-list.csv',
      ['Name', 'Email', 'Last Active On', 'Role Titles'],
      data.recruiters.map((row) => [row.name, row.email, row.last_active_at, row.role_titles]),
    );
    if (data.limited && data.message) {
      setDownloadToast({ message: data.message, type: 'error' });
    }
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
        canonical={canonicalUrl}
        jsonLd={jsonLd}
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
          Below are the bench sales recruiters our system has seen most recently posting available consultants — sourced from live market activity rather than a static directory that goes stale within weeks. If you're a recruiter looking for consultants to submit against your open requirements, this is who's actively marketing candidates right now.
        </p>
        {(refreshedAt || totalCount30d != null) && (
          <p className="mt-4 text-xs font-medium text-gray-400">
            {totalCount30d != null && (
              <span className="text-gray-600">{totalCount30d.toLocaleString('en-US')} recruiters active in the last 30 days.</span>
            )}
            {totalCount30d != null && refreshedAt && ' · '}
            {refreshedAt && <>Last updated: {formatTimestamp(refreshedAt)}</>}
          </p>
        )}

        <div className="mt-3">
          {error ? (
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-10 text-center text-sm text-gray-500">{error}</div>
          ) : (
            <GatedPreviewTable
              rows={rows}
              tabLabel="Recruiters"
              onDownload={handleDownload}
              onSignedIn={() => { void performDownload(); }}
              downloadLabel={user ? 'Download full CSV' : 'Log in to download full list'}
              loading={loading}
              totalCount={totalCount30d}
            />
          )}
        </div>

        <ContentSection title="What Is Bench Sales? What Is a Hotlist?">
          <p>
            Bench sales is the practice of marketing IT consultants who are between projects — "on the bench" — to vendors and clients to line up their next corp-to-corp (C2C) placement. A hotlist is how that marketing happens in practice: a running list of available consultants, their skills, rate, visa status, location, and availability, sent to vendors looking to fill open requirements.
          </p>
          <p>
            This page is the reverse of a vendor list: instead of showing who's hiring, it shows the bench sales recruiters actively marketing consultants right now — the people a vendor with an open requirement would want to reach.
          </p>
        </ContentSection>

        <ContentSection title="How This List Is Sourced and Updated">
          <p>
            Every contact below comes from a public hotlist or consultant-marketing post on LinkedIn, matched to the recruiter who posted it and deduplicated by email — not purchased or pulled from a static database.
          </p>
          <p>
            The page refreshes hourly, and the count above the table reflects everyone active in the last 30 days, not just the 10 shown free. That's a meaningful difference from most bench sales contact lists circulating online, several of which are years-old spreadsheets or blog posts still being shared long after the people on them changed roles or companies.
          </p>
        </ContentSection>

        <ContentSection title="How to Read a Hotlist">
          <p>A well-formed hotlist entry usually covers five things, and knowing the shorthand helps you scan one fast:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-gray-800">Rate</strong> — the consultant's expected bill rate, sometimes listed as a range.</li>
            <li><strong className="text-gray-800">Visa status</strong> — OPT, CPT, H1B, GC (green card), or USC (US citizen); this alone rules a consultant in or out for many requirements before anything else is considered.</li>
            <li><strong className="text-gray-800">Location</strong> — current location and whether they're open to relocation.</li>
            <li><strong className="text-gray-800">Availability</strong> — remote, onsite, hybrid, and how soon they can start.</li>
            <li><strong className="text-gray-800">Skills</strong> — the core technology stack or role the consultant is marketed for.</li>
          </ul>
          <p>A hotlist missing any of these usually gets skipped in favor of one that doesn't make the vendor ask follow-up questions.</p>
        </ContentSection>

        <ContentSection title="Bench Sales Recruiter vs. Account Manager">
          <p>
            The two roles are often confused because they sit on either side of the same transaction. A bench sales recruiter represents the consultant side — marketing available candidates to find their next placement. An account manager (or vendor manager) represents the requirement side — managing the client or vendor relationship and the open positions that need to be filled.
          </p>
          <p>In a smaller staffing company, one person often does both. In larger ones, they're separate roles working the same deal from opposite ends.</p>
        </ContentSection>

        <ContentSection title="W2 vs. C2C vs. 1099">
          <p>How a consultant is marketed on a hotlist usually specifies which engagement types they're open to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-gray-800">W2</strong> — the consultant is a direct employee, with taxes withheld from pay.</li>
            <li><strong className="text-gray-800">C2C (corp-to-corp)</strong> — one company invoices another for the consultant's services; the consultant is typically an employee or owner of their own corporation.</li>
            <li><strong className="text-gray-800">1099</strong> — the consultant is an independent contractor, paid without tax withholding.</li>
          </ul>
          <p>Visa status interacts with this directly — some engagement types aren't available to consultants on certain visa categories, so hotlists that state both up front get faster responses.</p>
        </ContentSection>

        <ContentSection title="Who's Who in a C2C Placement">
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Who They Are</th>
                  <th className="px-3 py-2">Their Part in the Placement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {PLACEMENT_CHAIN_ROWS.map((row) => (
                  <tr key={row.layer}>
                    <td className="px-3 py-2 align-top font-semibold whitespace-nowrap text-gray-800">{row.layer}</td>
                    <td className="px-3 py-2 align-top text-gray-600">{row.who}</td>
                    <td className="px-3 py-2 align-top text-gray-600">{row.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ContentSection>

        <ContentSection title="Bench Sales Best Practices">
          <p>A few habits separate bench sales recruiters who place consultants quickly from ones whose hotlists get ignored:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Send targeted submissions, not mass blasts. A hotlist entry that matches the specific requirement gets read; a generic one sent to every vendor on a list doesn't.</li>
            <li>Keep the hotlist current. Update rate, availability, and status the moment anything changes — a submission for a consultant who's already placed wastes everyone's time and damages trust.</li>
            <li>Submit fast. Requirements close quickly, and a same-day response beats a stronger candidate submitted two days later.</li>
            <li>Be upfront about visa status and rate. Vendors skip submissions that make them dig for the basics.</li>
          </ul>
        </ContentSection>

        <ContentSection title="Commonly Marketed Skills on Hotlists">
          <p>
            Hotlists on this page span the full range of US IT staffing demand, but a few categories show up consistently: Java and full-stack development, .NET, data engineering and ETL, QA/testing, SAP, DevOps and cloud (AWS/Azure), mainframe, and business/systems analysis. If you're scanning for a specific skill, the Role Titles column in the table above is searchable with your browser's find function (Ctrl/Cmd+F) — search for the technology you're hiring for directly.
          </p>
        </ContentSection>

        <ContentSection title="Glossary">
          <GlossaryList terms={RECRUITER_GLOSSARY} />
        </ContentSection>

        <section className="mt-10">
          <h2 className="text-lg font-bold text-gray-900">Frequently asked questions</h2>
          <FaqAccordion items={RECRUITER_FAQS} />
          <p className="mt-4 text-sm leading-6 text-gray-600">
            Looking for who's hiring, not who's available? See our <a href="/it-staffing-vendor-list" className="font-semibold text-blue-600 hover:underline">IT staffing vendor list</a>.
          </p>
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
      {downloadToast && <Toast message={downloadToast.message} type={downloadToast.type} onClose={() => setDownloadToast(null)} />}
    </div>
  );
}
