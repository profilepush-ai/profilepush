import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Logo from '../components/Logo';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import { type ActiveListContact } from '../components/ActiveListTable';
import GatedPreviewTable from '../components/GatedPreviewTable';
import SignInPromptModal from '../components/SignInPromptModal';
import ContentSection from '../components/ContentSection';
import FaqAccordion, { type FaqEntry } from '../components/FaqAccordion';
import GlossaryList, { type GlossaryTerm } from '../components/GlossaryList';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { downloadCsv } from '../lib/csv';

const WORKER_URL = (import.meta.env.VITE_ACTIVE_LIST_WORKER_URL ?? '').trim();
const WORKER_TOKEN = (import.meta.env.VITE_ACTIVE_LIST_WORKER_TOKEN ?? '').trim();
const PAGE_PATH = '/it-staffing-vendor-list';

function monthYear() {
  return new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function formatTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

const VENDOR_CHAIN_ROWS: { layer: string; who: string; meaning: string }[] = [
  { layer: 'End Client', who: 'The company with the actual open position.', meaning: 'Rarely reachable directly; almost all submissions go through a vendor.' },
  { layer: 'Prime Vendor', who: 'Holds the direct staffing contract with the client or its MSP.', meaning: 'Fewest steps to the client — generally faster decisions and better margins.' },
  { layer: 'Tier 1 / Sub-vendor', who: "Works beneath a prime vendor without a direct client contract.", meaning: 'One extra layer, and typically a smaller share of the bill rate.' },
  { layer: 'Tier 2+ Vendor', who: 'Works beneath a Tier 1 vendor.', meaning: 'Multiple layers removed from the client — slower and lower-margin, but still a legitimate path to placement.' },
  { layer: 'Implementation Partner', who: 'Has a formal, ongoing relationship tied to a specific technology platform or client program.', meaning: 'Often sees requirements for that platform before they reach the general vendor pool.' },
];

const VENDOR_GLOSSARY: GlossaryTerm[] = [
  { term: 'C2C (Corp-to-Corp)', definition: "An engagement where one company invoices another for a consultant's services, rather than the consultant being a direct employee of either company." },
  { term: 'W2', definition: 'An employment arrangement where the consultant is a direct employee of the staffing company or client, with taxes withheld from pay.' },
  { term: '1099', definition: 'An independent-contractor arrangement where the consultant is paid without tax withholding and handles their own taxes.' },
  { term: 'C2H (Contract-to-Hire)', definition: 'A contract role with a built-in path to convert to full-time direct employment with the client, typically after 3-6 months.' },
  { term: 'Prime Vendor', definition: "A vendor with a direct staffing contract with the end client or the client's MSP." },
  { term: 'Sub-vendor (Tier 2 Vendor)', definition: "A vendor that works beneath a prime vendor and doesn't have a direct contract with the client." },
  { term: 'Implementation Partner', definition: 'A vendor with a formal, ongoing partnership tied to a specific technology platform or client program.' },
  { term: 'MSP (Managed Service Provider)', definition: "A third party that manages a client's entire contingent workforce program on the client's behalf." },
  { term: 'VMS (Vendor Management System)', definition: 'The software platform used to post requirements and manage vendor submissions within an MSP program.' },
  { term: 'Hotlist', definition: "A recruiter's list of available consultants marketed to vendors — the mirror image of a vendor list." },
  { term: 'Bench Sales', definition: 'Marketing consultants who are between projects to vendors and clients to secure their next placement.' },
  { term: 'RTR (Right to Represent)', definition: "A signed authorization a vendor gets from a consultant before submitting their profile to a client, confirming they're allowed to represent them for that specific requirement." },
];

const VENDOR_FAQS: FaqEntry[] = [
  { q: 'What is an IT staffing vendor list?', a: "A vendor list is a working directory of the staffing companies and recruiters actively sourcing consultants for open corp-to-corp (C2C) job requirements in the US. It's used by bench sales recruiters and account managers to know who's hiring right now and where to submit candidates." },
  { q: "What's the difference between a vendor and a direct client?", a: 'A direct client is the company that actually has the open position and will employ or contract the consultant. A vendor is a staffing company (or a recruiter within one) that sources and submits candidates for that position — sometimes directly to the client, sometimes through one or more other vendors in between.' },
  { q: 'What is a prime vendor?', a: "A prime vendor holds a direct contract with the end client (or with the client's MSP) to fill a requirement. Working with a prime vendor generally means fewer steps between your submission and the client, which usually means faster decisions and better margins." },
  { q: "What's the difference between a prime vendor and a sub-vendor?", a: "A prime vendor has the direct contract with the client; a sub-vendor (or Tier 2 vendor) works under a prime vendor and doesn't have that direct relationship. Submissions from a sub-vendor pass through the prime vendor before reaching the client, adding a layer — and often a margin cut — to the chain." },
  { q: "What's the difference between a prime vendor and an implementation partner?", a: 'An implementation partner has a formal, ongoing relationship with a specific technology platform or client program, not just a one-off staffing contract. They often get first look at requirements tied to that platform before the role opens to the wider vendor pool.' },
  { q: "What's the difference between a Tier 1 and a Tier 2 vendor?", a: 'Tier 1 vendors sit closest to the client — often the prime vendor itself or one layer below. Tier 2 vendors are one or more layers further removed. Fewer tiers between you and the client generally means faster turnaround and a bigger share of the bill rate.' },
  { q: 'How do I get my company added to an approved or preferred vendor list?', a: 'Most clients and MSPs maintain their own approved vendor lists, and getting added usually means being invited after consistently delivering quality, compliant submissions through an existing relationship — not applying cold. Building relationships with prime vendors and consistently sending well-screened candidates is the most reliable path in.' },
  { q: 'What is a direct client, and how is it different from an indirect one?', a: "A direct client is the actual employer or end company with the open requirement. An indirect relationship usually means you're working the requirement through a vendor rather than dealing with the client's hiring team directly." },
  { q: 'What is bench sales, and how does it relate to a vendor list?', a: "Bench sales is the practice of marketing consultants who are between projects (\"on the bench\") to vendors and clients to line up their next placement. A vendor list is the other half of that process — it's who a bench sales recruiter submits those consultants to." },
  { q: "What's the difference between W2, C2C, and 1099?", a: "W2 means the consultant is a direct employee (taxes withheld, typically some benefits eligibility). C2C means one company invoices another for the consultant's services. 1099 means the consultant is an independent contractor paid without tax withholding. Most requirements specify which of the three they'll accept." },
  { q: 'What is C2H (contract-to-hire)?', a: 'C2H means the role starts as a contract engagement with the option — sometimes the expectation — of converting to a full-time direct hire with the client after a defined period, commonly 3-6 months.' },
  { q: 'What is an MSP in IT staffing?', a: "An MSP (Managed Service Provider) is a third party a client hires to manage its entire contingent workforce program — collecting requirements from hiring managers and distributing them to approved vendors, usually through a VMS." },
  { q: 'What is a VMS, and how does it relate to an MSP?', a: 'A VMS (Vendor Management System) is the software platform an MSP — or the client directly — uses to post requirements, receive vendor submissions, and track the hiring workflow. The MSP runs the program; the VMS is the tool it runs on.' },
  { q: 'How does the MSP/VMS process affect which vendors get submissions?', a: "Only vendors pre-approved in the client's VMS can submit candidates for that client's requirements. Being on a great vendor list doesn't help if your company isn't onboarded in the specific VMS the requirement runs through — getting VMS-approved is often the real bottleneck." },
  { q: 'How often is this vendor list updated?', a: 'The underlying data refreshes continuously as new activity is scraped, and this page\'s cache refreshes hourly, so the "Last updated" timestamp above reflects data that\'s at most an hour old.' },
  { q: 'Are free downloadable vendor or email lists usually accurate and up to date?', a: "Rarely. Most free vendor lists circulating online are static exports — spreadsheets or PDFs — that were accurate the day they were compiled and go stale within weeks. This page is built to avoid that by refreshing from live activity instead of shipping a fixed snapshot." },
  { q: 'Is it okay to cold-email a recruiter or vendor from a list like this?', a: 'Yes, within reason — these are business contacts who posted a public requirement looking to be found, and a relevant, well-targeted submission is exactly what they want. What crosses the line is blasting the same generic message regardless of fit, or emailing at high volume; keep outreach specific to the requirement and the recipient.' },
  { q: 'What should I include when reaching out to a new vendor for the first time?', a: "Reference the specific requirement you're responding to, lead with the consultant's most relevant skills and availability, and include rate expectations and visa/work-authorization status up front — vendors are scanning dozens of submissions and will skip anything that makes them dig for the basics." },
  { q: 'How is this vendor list different from a static PDF or Excel vendor list?', a: "Most vendor lists you'll find online are one-time exports that stop being accurate the moment people change jobs. This one is compiled from continuously scraped, real-time posting activity and refreshed hourly, so the contacts you see have posted a requirement recently — not at some unknown point in the past." },
  { q: 'Where do the vendor contacts on this page come from?', a: "They're compiled from public job requirement posts on LinkedIn, matched to the person who posted them, deduplicated by email, and ranked by how recently they were active." },
  { q: 'How many vendors are in the free preview versus the full list?', a: 'The 10 most recently active vendors are shown here free, with real names and emails. The total shown above the table (updated hourly) reflects every vendor active in the last 30 days — sign in to a free ProfilePush account to see and download the rest.' },
  { q: 'Can I trust the contact information on this list?', a: 'Every contact is a real name and email pulled directly from a public post, not inferred or purchased from a third-party database, so accuracy depends only on how recently that person posted.' },
  { q: "What's the difference between a vendor list and a recruiter database?", a: "A vendor list focuses on companies and recruiters actively posting open C2C requirements right now — it's about current demand. A general recruiter database is broader and not tied to active postings, so it's more likely to include stale or irrelevant contacts." },
  { q: 'Does this page only show US IT staffing vendors?', a: "Yes — the underlying data is scoped to US corp-to-corp IT staffing activity, the same market ProfilePush's core matching product is built for." },
];

export default function ItStaffingVendorListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rows, setRows] = useState<ActiveListContact[]>([]);
  const [refreshedAt, setRefreshedAt] = useState('');
  const [totalCount30d, setTotalCount30d] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showSignIn, setShowSignIn] = useState(false);

  const title = useMemo(() => `IT Staffing Vendor List (${monthYear()})`, []);
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
      ? ` ${totalCount30d.toLocaleString('en-US')} vendors have been active in the last 30 days.`
      : '';

    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'WebPage',
          name: title,
          description: `A live, continuously-refreshed list of IT staffing vendors actively posting new job requirements.${countSentence}`,
          url: canonicalUrl,
          publisher: { '@id': 'https://profilepush.ai/#organization' },
        },
        {
          '@type': 'Dataset',
          name: title,
          description: `A live directory of IT staffing vendors actively posting new C2C job requirements, compiled from continuously scraped market activity and refreshed hourly.${countSentence}`,
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
        { '@type': 'FAQPage', mainEntity: VENDOR_FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) },
        { '@type': 'DefinedTermSet', name: `${title} glossary`, hasDefinedTerm: VENDOR_GLOSSARY.map((t) => ({ '@type': 'DefinedTerm', name: t.term, description: t.definition })) },
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
        const response = await fetch(`${WORKER_URL.replace(/\/$/, '')}/vendors`, {
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
    const { data, error: invokeError } = await supabase.functions.invoke<{ vendors: ActiveListContact[] }>('active-list', { body: { hours_back: 720 } });
    if (invokeError || !data) return;
    downloadCsv(
      'it-staffing-vendor-list.csv',
      ['Name', 'Email', 'Last Active On', 'Role Titles'],
      data.vendors.map((row) => [row.name, row.email, row.last_active_at, row.role_titles]),
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
        description={`A live, ${monthYear()} list of IT staffing vendors actively posting new job requirements. See the 100 most recently active free, or log in to download the full list.`}
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
          Below are the vendors our system has seen most recently posting new job requirements — pulled from live market activity, not a stale monthly export. The vendors below have open requirements <em>right now</em>, not a snapshot from weeks ago.
        </p>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          The first 10 of the 100 most recently active vendors are free to browse below, with real names and emails. <a href="/signup" className="font-semibold text-blue-600 hover:underline">Create a free ProfilePush account</a> to page through the rest and download the complete list, plus daily digest emails as new vendors go active.
        </p>

        {(refreshedAt || totalCount30d != null) && (
          <p className="mt-4 text-xs font-medium text-gray-400">
            {totalCount30d != null && (
              <span className="text-gray-600">{totalCount30d.toLocaleString('en-US')} vendors active in the last 30 days.</span>
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
              tabLabel="Vendors"
              onDownload={handleDownload}
              downloadLabel={user ? 'Download full CSV' : 'Log in to download full list'}
              loading={loading}
            />
          )}
        </div>

        <ContentSection title="What Is an IT Staffing Vendor List?">
          <p>
            In US IT staffing, a vendor is the staffing company or individual recruiter sourcing candidates for an open corp-to-corp (C2C) requirement — not the end client with the job opening. A vendor list is a working directory of who's actively doing that sourcing right now: real names, real emails, and what they're currently hiring for.
          </p>
          <p>
            For a bench sales recruiter or account manager, a vendor list answers the question that matters most day to day: who has open requirements today, and how do I reach them? That's different from a general staffing-company directory, which tells you who exists in the industry but not who's actually hiring this week.
          </p>
        </ContentSection>

        <ContentSection title="How This List Is Sourced and Updated">
          <p>
            Every contact below comes from a public job requirement posted on LinkedIn, matched to the person who posted it and deduplicated by email. Nothing here is purchased or pulled from a static database — it's built from the same live activity ProfilePush's matching engine already tracks for its own users.
          </p>
          <p>
            The page refreshes on an hourly cycle, and the count above the table reflects everyone active in the last 30 days, not just the 10 shown for free. Compare that to most "vendor list" resources you'll find searching for this — static PDFs, Excel exports, and forum posts, some over a decade old, that were accurate the day they were made and have been going stale ever since.
          </p>
        </ContentSection>

        <ContentSection title="Vendor Chain and Tiers, Explained">
          <p>A single requirement can pass through several layers before it reaches you, and where a vendor sits in that chain affects both how fast decisions happen and how much margin is left by the time it gets to your candidate.</p>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-3 py-2">Layer</th>
                  <th className="px-3 py-2">Who They Are</th>
                  <th className="px-3 py-2">What That Means For You</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {VENDOR_CHAIN_ROWS.map((row) => (
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

        <ContentSection title="W2 vs. C2C vs. 1099: What It Means for a Submission">
          <p>Nearly every requirement specifies which engagement types it will accept, and matching that upfront saves everyone time.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li><strong className="text-gray-800">W2</strong> — the consultant is a direct employee (of the staffing company or the client), with taxes withheld from pay and typically some benefits eligibility.</li>
            <li><strong className="text-gray-800">C2C (corp-to-corp)</strong> — one company invoices another for the consultant's services; the consultant is usually an employee or owner of their own corporation rather than either company's direct employee.</li>
            <li><strong className="text-gray-800">1099</strong> — the consultant is paid as an independent contractor with no tax withholding and files their own taxes.</li>
          </ul>
          <p>Visa status often narrows this further — some engagement types and clients only accept certain work-authorization categories, so it's worth confirming both before submitting.</p>
        </ContentSection>

        <ContentSection title="What Are MSPs and VMS Platforms?">
          <p>
            Larger clients rarely manage contingent hiring themselves. Instead they hire an MSP (Managed Service Provider) to run the whole program — collecting requirements from hiring managers, distributing them to an approved vendor pool, and managing submissions through a VMS (Vendor Management System), the software both sides use to post roles and track candidates.
          </p>
          <p>
            This matters for vendor-list outreach specifically: being on a great vendor list doesn't help if your company isn't already approved inside the client's VMS. For MSP-managed accounts, getting VMS-approved is usually the real bottleneck — not finding the requirement itself.
          </p>
        </ContentSection>

        <ContentSection title="How to Get Your Company Added to a Vendor List">
          <p>There's no public application most prime vendors use — access is earned through relationships, not a form. A few things reliably help:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Submit clean, accurate profiles. Vendors remember which sub-vendors send candidates that actually match the requirement and which ones don't.</li>
            <li>Respond fast. Requirements get filled quickly, and a same-day submission beats a better candidate submitted two days late.</li>
            <li>Get referred. A warm introduction from a sub-vendor or consultant already working with a prime vendor moves faster than any cold outreach.</li>
            <li>Stay consistent. Vendors build long-term relationships with sub-vendors who deliver reliably over months, not a one-off good submission.</li>
          </ul>
        </ContentSection>

        <ContentSection title="Vendor Outreach Etiquette">
          <p>A vendor contact list is only useful if the outreach built on it gets responses instead of ignored or blocked. A few norms worth following:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Reference the specific requirement you're responding to — generic "do you have any openings" messages get skipped.</li>
            <li>Lead with what matters to the reader: skill match, availability, rate, and visa/work-authorization status, in that order.</li>
            <li>Keep volume reasonable. A handful of relevant submissions outperforms a mass blast every time, and vendors remember who spams them.</li>
            <li>Respect a "no" or no response — following up once is fine; repeated unsolicited contact after being asked to stop isn't.</li>
          </ul>
        </ContentSection>

        <ContentSection title="A Live List vs. a Static Vendor List">
          <p>
            Most vendor and hotlist resources online are a snapshot: someone compiled a spreadsheet or PDF at some point and it's been circulating since, sometimes for years, without anyone confirming the contacts still work there or are still hiring.
          </p>
          <p>
            This page works differently. It's built from continuously scraped, live posting activity, refreshed hourly, so the "10 most recent" you see free is genuinely the 10 most recently active — not the 10 that happened to be first in a spreadsheet someone made last year.
          </p>
        </ContentSection>

        <ContentSection title="Glossary">
          <GlossaryList terms={VENDOR_GLOSSARY} />
        </ContentSection>

        <section className="mt-10">
          <h2 className="text-lg font-bold text-gray-900">Frequently asked questions</h2>
          <FaqAccordion items={VENDOR_FAQS} />
          <p className="mt-4 text-sm leading-6 text-gray-600">
            Looking for the other side of a C2C placement? See our <a href="/it-staffing-bench-sales-recruiters-list" className="font-semibold text-blue-600 hover:underline">bench sales recruiters list</a>.
          </p>
        </section>
      </div>
      <SiteFooter />
      <SignInPromptModal
        open={showSignIn}
        onClose={() => setShowSignIn(false)}
        onSuccess={() => { setShowSignIn(false); navigate('/active-list?tab=vendors'); }}
        message="Sign in to download the full vendor list."
        signInPath={PAGE_PATH}
      />
    </div>
  );
}
