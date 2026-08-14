import { Link, useParams, Navigate } from 'react-router-dom';
import { Check, X, ArrowRight, Zap, Target, Users, Search, Brain, FileText, Activity, Star, ChevronRight } from 'lucide-react';
import Logo from '../components/Logo';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';

// ── Competitor data ────────────────────────────────────────────────────────────
interface Competitor {
  slug: string;
  name: string;
  tagline: string;
  whatItIs: string;
  heroHeadline: string;
  heroSub: string;
  accentColor: string;
  accentBg: string;
  verdict: string;
  differentiators: { icon: typeof Zap; title: string; body: string }[];
  faqs: { q: string; a: string }[];
}

type FeatureRow = {
  feature: string;
  category: string;
  pp: true | false | 'partial';
  them: true | false | 'partial';
  note?: string;
};

const FEATURES: FeatureRow[] = [
  { category: 'Sourcing', feature: 'Live requirement feed (Jobs)', pp: true, them: false },
  { category: 'Sourcing', feature: 'Live available-consultant feed (Hotlist)', pp: true, them: false },
  { category: 'Sourcing', feature: '500+ LinkedIn/Facebook/WhatsApp/Reddit groups scanned 24/7', pp: true, them: false },
  { category: 'Sourcing', feature: 'Job board coverage', pp: true, them: 'partial' },
  { category: 'AI', feature: 'Market-demand leaderboard by role (Pulse)', pp: true, them: false },
  { category: 'AI', feature: 'AI-drafted outreach emails (Inbox)', pp: true, them: false },
  { category: 'AI', feature: 'Delivery & reply tracking on outreach', pp: true, them: false },
  { category: 'Recruiting', feature: 'Vendor & client CRM (Tracker)', pp: true, them: 'partial' },
  { category: 'Recruiting', feature: 'Submission tracking (C2C/W2/Direct)', pp: true, them: 'partial' },
  { category: 'Recruiting', feature: 'Double-submittal protection', pp: true, them: false },
  { category: 'Recruiting', feature: 'CSV export', pp: true, them: 'partial' },
  { category: 'Team', feature: 'Multi-user team workspace', pp: true, them: 'partial' },
  { category: 'Team', feature: 'Built for both sides of the desk (bench sales + vendor teams)', pp: true, them: false },
  { category: 'Team', feature: 'Purpose-built for US IT staffing', pp: true, them: false },
  { category: 'Pricing', feature: 'Free forever plan', pp: true, them: false },
  { category: 'Pricing', feature: 'No forced per-user upsells', pp: true, them: false },
];

const FEATURES_CEIPAL: FeatureRow[] = FEATURES.map(f => {
  if (f.feature === 'Submission tracking (C2C/W2/Direct)') return { ...f, them: true };
  if (f.feature === 'Multi-user team workspace') return { ...f, them: true };
  if (f.feature === 'CSV export') return { ...f, them: true };
  return f;
});

const FEATURES_JOBRIGHT: FeatureRow[] = FEATURES.map(f => {
  if (f.feature === 'Vendor & client CRM (Tracker)') return { ...f, them: false, note: 'Job-seeker side only' };
  if (f.feature === 'Submission tracking (C2C/W2/Direct)') return { ...f, them: false };
  if (f.feature === 'CSV export') return { ...f, them: false };
  if (f.feature === 'Multi-user team workspace') return { ...f, them: false };
  return f;
});

const FEATURES_APPLYNXT: FeatureRow[] = FEATURES.map(f => {
  if (f.feature === 'Vendor & client CRM (Tracker)') return { ...f, them: false, note: 'Job-seeker side only' };
  if (f.feature === 'Submission tracking (C2C/W2/Direct)') return { ...f, them: false };
  if (f.feature === 'CSV export') return { ...f, them: false };
  if (f.feature === 'Multi-user team workspace') return { ...f, them: false };
  return f;
});

const COMPETITORS: Record<string, Competitor & { featureRows: FeatureRow[] }> = {
  ceipal: {
    slug: 'ceipal',
    name: 'Ceipal',
    tagline: 'Enterprise ATS & Staffing Platform',
    whatItIs: 'Ceipal is a broad applicant tracking system built for staffing agencies — covering onboarding, compliance, payroll integrations, and candidate pipelines. It does a lot, but it wasn\'t built for the day-to-day sourcing and outreach grind that bench sales recruiters and vendor teams run every day.',
    heroHeadline: 'ProfilePush vs Ceipal',
    heroSub: 'Ceipal manages your ATS pipeline. ProfilePush fills it — watching 500+ LinkedIn, Facebook, WhatsApp, and Reddit groups plus job boards 24/7, surfacing matched requirements and consultants, and drafting your outreach automatically.',
    accentColor: 'text-blue-600',
    accentBg: 'bg-blue-50',
    verdict: 'Ceipal is an enterprise ATS. ProfilePush is the AI copilot that feeds it — sourcing, matching, and outreach for both bench sales recruiters and vendor teams. The two solve different problems, but if your bottleneck is finding and reaching the right person faster, ProfilePush is the clear choice.',
    differentiators: [
      {
        icon: Search,
        title: 'Built to watch 500+ groups, not just boards.',
        body: 'Ceipal doesn\'t scan LinkedIn, Facebook, WhatsApp, and Reddit groups for fresh requirements and consultants. ProfilePush does — 24/7, so you see new leads the moment they post instead of searching for them.',
      },
      {
        icon: Brain,
        title: 'Real AI outreach, not just a pipeline view.',
        body: 'Ceipal shows you a pipeline. ProfilePush drafts and sends the outreach email for you — one click, with opens and replies tracked — so you\'re not writing the same email fifty times a day.',
      },
      {
        icon: Target,
        title: 'Built for both sides of the desk.',
        body: 'Ceipal serves every vertical the same way. ProfilePush is purpose-built for US IT staffing — Jobs and Hotlist mirror the two real workflows: filling your bench with requirements, and filling a requirement with a consultant.',
      },
    ],
    faqs: [
      { q: 'Can I use ProfilePush alongside Ceipal?', a: 'Yes. ProfilePush handles sourcing, matching, and outreach — Pulse, Jobs, Hotlist, and Inbox — while you continue managing compliance, payroll, and contracts in Ceipal. They complement each other well.' },
      { q: 'Is ProfilePush cheaper than Ceipal?', a: 'ProfilePush has a free forever plan with monthly AI credits, and a Pro plan at ₹2,500/month with unlimited users. Ceipal is priced as enterprise ATS software and typically costs significantly more per seat.' },
      { q: 'Does Ceipal watch social groups for new requirements?', a: 'No. Ceipal is built around job board postings and pipeline management, not real-time monitoring of LinkedIn, Facebook, WhatsApp, and Reddit groups the way ProfilePush\'s Jobs and Hotlist feeds do.' },
    ],
    featureRows: FEATURES_CEIPAL,
  },

  'jobright-ai': {
    slug: 'jobright-ai',
    name: 'Jobright.ai',
    tagline: 'AI Job Search Platform for Job Seekers',
    whatItIs: 'Jobright.ai is an AI tool designed to help individual job seekers find and track job opportunities for themselves. It\'s a job-seeker tool, not a recruiter or vendor-team tool — it has no concept of a bench, an open requirement, or a client relationship.',
    heroHeadline: 'ProfilePush vs Jobright.ai',
    heroSub: 'Jobright.ai helps a candidate find a job for themselves. ProfilePush is built for the other side of the desk — bench sales recruiters sourcing requirements and vendor teams sourcing consultants — with AI that watches 500+ groups and job boards for you.',
    accentColor: 'text-orange-600',
    accentBg: 'bg-orange-50',
    verdict: 'Jobright.ai and ProfilePush serve opposite ends of the same pipeline. If you\'re a recruiter or vendor team managing a bench or a requirement, ProfilePush was built for exactly what you do — Jobright.ai was not.',
    differentiators: [
      {
        icon: Users,
        title: 'Built for staffing desks, not solo job seekers.',
        body: 'Jobright.ai is a self-serve tool for one person tracking their own applications. ProfilePush is for bench sales recruiters and vendor teams running multiple consultants, multiple clients, and multiple requirements at once.',
      },
      {
        icon: Search,
        title: 'Two-sided matching, not one-sided search.',
        body: 'Jobright.ai only matches jobs to a single candidate\'s resume. ProfilePush runs both directions — Jobs matches requirements to your bench, Hotlist matches available consultants to your open requirements.',
      },
      {
        icon: FileText,
        title: 'Outreach built in, not left to you.',
        body: 'Jobright.ai stops at showing you a job. ProfilePush\'s Inbox drafts and sends the outreach email — requesting job details or a resume — and tracks the reply, so you\'re not starting from a blank compose window.',
      },
    ],
    faqs: [
      { q: 'Is Jobright.ai useful for recruiters or vendor teams?', a: 'Jobright.ai is built for individual job seekers managing their own search. It has no workspace for a recruiting team, no CRM, and no concept of sourcing candidates for someone else.' },
      { q: 'What does ProfilePush do that Jobright.ai cannot?', a: 'ProfilePush runs Pulse, Jobs, Hotlist, Inbox, and Tracker — market intelligence, two-sided AI matching, AI-drafted outreach, and a vendor/client CRM — all built for a staffing team, not a solo job seeker.' },
      { q: 'Is there a recruiter version of Jobright.ai?', a: 'Not currently — Jobright.ai is positioned squarely as a job-seeker product. ProfilePush was built from the ground up for the recruiter and vendor-team side of the same pipeline.' },
    ],
    featureRows: FEATURES_JOBRIGHT,
  },

  'drivetube-ai': {
    slug: 'drivetube-ai',
    name: 'DriveTube.ai',
    tagline: 'AI Recruiting Assistant',
    whatItIs: 'DriveTube.ai is an AI-powered recruiting assistant aimed at streamlining parts of the hiring workflow. It applies AI to general recruiting tasks, but it lacks the IT-staffing-specific depth — social group monitoring, two-sided bench/requirement matching, and a vendor CRM — that US IT staffing desks run on.',
    heroHeadline: 'ProfilePush vs DriveTube.ai',
    heroSub: 'DriveTube.ai brings general AI to recruiting workflows. ProfilePush brings AI to the specific US IT staffing loop — market intelligence, matched requirements and consultants, AI-drafted outreach, and a CRM built for vendors and clients.',
    accentColor: 'text-blue-600',
    accentBg: 'bg-blue-50',
    verdict: 'DriveTube.ai covers recruiting AI broadly. ProfilePush goes deep on what US IT staffing teams need most — sourcing, matching, and outreach built specifically for bench sales recruiters and vendor teams.',
    differentiators: [
      {
        icon: Search,
        title: 'Sourcing depth built for IT staffing.',
        body: 'ProfilePush watches 500+ LinkedIn, Facebook, WhatsApp, and Reddit groups plus job boards — the places IT requirements and available consultants actually get posted. Most general recruiting AI tools don\'t monitor social groups at all.',
      },
      {
        icon: Brain,
        title: 'Matching that understands both sides.',
        body: 'ProfilePush\'s Jobs and Hotlist feeds are built around the two real IT-staffing workflows: filling your bench with requirements, and filling a requirement with a consultant. A generic recruiting assistant isn\'t built around that split.',
      },
      {
        icon: Activity,
        title: 'A CRM built for vendors, not just candidates.',
        body: 'Tracker logs every vendor and client contact, tags submissions by type (C2C, W2, Direct), and stops double-submittals — purpose-built for how staffing desks actually operate.',
      },
    ],
    faqs: [
      { q: 'How is ProfilePush different from DriveTube.ai?', a: 'ProfilePush is purpose-built for US IT staffing — with 24/7 social group monitoring, two-sided AI matching (Jobs and Hotlist), AI-drafted outreach (Inbox), and a vendor/client CRM (Tracker). It covers the full staffing loop, not general recruiting tasks.' },
      { q: 'Does DriveTube.ai watch social groups for new leads?', a: 'DriveTube.ai focuses on general AI-assisted recruiting tasks; it does not offer the kind of real-time social-group monitoring across LinkedIn, Facebook, WhatsApp, and Reddit that ProfilePush\'s Jobs and Hotlist feeds provide.' },
      { q: 'Which tool is better for offshore staffing teams?', a: 'ProfilePush is built for offshore bench sales and vendor teams working US placements — every match, reveal, and outreach is logged so team output stays visible across time zones.' },
    ],
    featureRows: FEATURES,
  },

  'apply-nxt': {
    slug: 'apply-nxt',
    name: 'Apply.nxt',
    tagline: 'Automated Job Application Platform',
    whatItIs: 'Apply.nxt automates the job application process for individuals — helping a job seeker submit applications to many jobs quickly. Like Jobright.ai, it\'s a job-seeker automation tool, not a recruiter or vendor-team platform — it has no bench, no CRM, and no two-sided matching.',
    heroHeadline: 'ProfilePush vs Apply.nxt',
    heroSub: 'Apply.nxt automates applying to jobs for one person. ProfilePush automates the recruiter\'s and vendor team\'s side of the same pipeline — finding, matching, and reaching out — built for US IT staffing.',
    accentColor: 'text-orange-600',
    accentBg: 'bg-orange-50',
    verdict: 'Apply.nxt solves auto-applying for job seekers. ProfilePush solves the staffing desk\'s end of the same pipeline — finding the right requirements or consultants, and reaching out with AI, without dropping a submission.',
    differentiators: [
      {
        icon: Users,
        title: 'The staffing desk\'s side of the pipeline.',
        body: 'Apply.nxt helps one candidate send out applications en masse. ProfilePush helps the recruiter or vendor team behind them — surfacing matched requirements and consultants, and drafting the outreach that gets a response.',
      },
      {
        icon: Target,
        title: 'Built for two-sided matching, not mass apply.',
        body: 'Mass applying is a job seeker\'s strategy. Staffing desks win by matching the right consultant to the right requirement — that\'s exactly what Jobs and Hotlist do.',
      },
      {
        icon: Activity,
        title: 'A CRM, not just a tracker.',
        body: 'Apply.nxt tracks one person\'s applications. Tracker manages your entire vendor and client pipeline — every contact, every submission, every double-submittal caught before it happens.',
      },
    ],
    faqs: [
      { q: 'Is Apply.nxt built for recruiters or vendor teams?', a: 'No. Apply.nxt automates job applications for individual job seekers. It has no workspace, CRM, or matching built for a staffing team.' },
      { q: 'Can ProfilePush replace Apply.nxt for my candidates?', a: 'ProfilePush handles the staffing desk\'s side — sourcing matched requirements and consultants, drafting outreach, and tracking every submission in Tracker. It\'s a different tool solving a different half of the pipeline.' },
      { q: 'What makes ProfilePush better for US IT staffing?', a: 'ProfilePush watches 500+ LinkedIn, Facebook, WhatsApp, and Reddit groups plus job boards 24/7, matches requirements and consultants both ways with Jobs and Hotlist, drafts outreach with Inbox, and keeps everything organized in Tracker — all in one workspace built for bench sales recruiters and vendor teams.' },
    ],
    featureRows: FEATURES_APPLYNXT,
  },
};

// ── Comparison table cell ──────────────────────────────────────────────────────
function Cell({ value, primary }: { value: true | false | 'partial'; primary?: boolean }) {
  if (value === true) {
    return (
      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full ${primary ? 'bg-blue-600' : 'bg-gray-100'}`}>
        <Check size={13} className={primary ? 'text-white' : 'text-gray-500'} strokeWidth={2.5} />
      </span>
    );
  }
  if (value === 'partial') {
    return (
      <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-yellow-100">
        <span className="w-2 h-2 rounded-full bg-yellow-400" />
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-50">
      <X size={13} className="text-gray-300" strokeWidth={2.5} />
    </span>
  );
}

// ── Nav ────────────────────────────────────────────────────────────────────────
function ComparisonNav() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2 text-blue-600 font-bold text-base">
          <Logo size="sm" />
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/signin" className="hidden sm:block text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
            Sign in
          </Link>
          <Link
            to="/signup"
            className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Start free <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ComparisonPage() {
  const { competitor } = useParams<{ competitor: string }>();
  const data = competitor ? COMPETITORS[competitor] : null;

  if (!data) return <Navigate to="/" replace />;

  const categories = [...new Set(data.featureRows.map(f => f.category))];

  const canonicalUrl = `https://profilepush.ai/vs/${data.slug}`;
  const metaTitle = `ProfilePush vs ${data.name} — Which Is Better for US IT Staffing Teams?`;
  const metaDesc = `Compare ProfilePush and ${data.name} side by side for US IT staffing — AI-matched requirements and consultants, AI-drafted outreach, and a vendor CRM, built for bench sales recruiters and vendor teams.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: metaTitle,
        description: metaDesc,
        url: canonicalUrl,
        publisher: { '@id': 'https://profilepush.ai/#organization' },
      },
      {
        '@type': 'FAQPage',
        mainEntity: data.faqs.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };

  const ppScore = data.featureRows.filter(r => r.pp === true).length;
  const themScore = data.featureRows.filter(r => r.them === true).length;

  return (
    <>
      <SEO
        title={metaTitle}
        description={metaDesc}
        canonical={canonicalUrl}
        jsonLd={jsonLd}
      />
      <ComparisonNav />

      <main className="pt-14">
        {/* ── Hero ── */}
        <section className="bg-white border-b border-gray-100 py-16 md:py-24">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 text-center">
            <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 text-blue-700 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-6">
              Comparison
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold text-gray-900 tracking-tight leading-[1.1] mb-5">
              {data.heroHeadline}
            </h1>
            <p className="text-base sm:text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed mb-8">
              {data.heroSub}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/signup"
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-7 py-3.5 rounded-xl transition-colors shadow-sm shadow-blue-200"
              >
                Try ProfilePush free <ArrowRight size={15} />
              </Link>
              <a
                href="#comparison"
                className="flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                See the comparison <ChevronRight size={14} />
              </a>
            </div>
          </div>
        </section>

        {/* ── Score banner ── */}
        <section className="bg-gray-50 border-b border-gray-100 py-8">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="grid grid-cols-3 gap-4 md:gap-8 max-w-lg mx-auto text-center">
              <div>
                <p className="text-3xl md:text-4xl font-extrabold text-blue-600">{ppScore}</p>
                <p className="text-xs text-gray-400 mt-1 font-medium">ProfilePush features</p>
              </div>
              <div className="flex items-center justify-center">
                <span className="text-gray-200 font-extrabold text-2xl">vs</span>
              </div>
              <div>
                <p className="text-3xl md:text-4xl font-extrabold text-gray-400">{themScore}</p>
                <p className="text-xs text-gray-400 mt-1 font-medium">{data.name} features</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── What is X? ── */}
        <section className="bg-white border-b border-gray-100 py-12 md:py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">About {data.name}</p>
            <p className="text-gray-600 text-base leading-relaxed">{data.whatItIs}</p>
          </div>
        </section>

        {/* ── Comparison table ── */}
        <section id="comparison" className="bg-white border-b border-gray-100 py-12 md:py-16">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-10">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Feature Comparison</p>
              <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900">ProfilePush vs {data.name}</h2>
            </div>

            <div className="rounded-2xl border border-gray-200 overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_140px_140px] bg-gray-50 border-b border-gray-200">
                <div className="px-5 py-3.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Feature</span>
                </div>
                <div className="px-4 py-3.5 text-center border-l border-gray-200 bg-blue-600">
                  <span className="text-[11px] font-extrabold uppercase tracking-wider text-white">ProfilePush</span>
                </div>
                <div className="px-4 py-3.5 text-center border-l border-gray-200">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-gray-500">{data.name}</span>
                </div>
              </div>

              {categories.map((cat, ci) => (
                <div key={cat}>
                  {/* Category header */}
                  <div className="grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_140px_140px] bg-gray-50 border-y border-gray-100">
                    <div className="px-5 py-2">
                      <span className="text-[10px] font-extrabold uppercase tracking-widest text-gray-400">{cat}</span>
                    </div>
                    <div className="border-l border-gray-100 bg-blue-600/5" />
                    <div className="border-l border-gray-100" />
                  </div>
                  {/* Feature rows */}
                  {data.featureRows.filter(f => f.category === cat).map((row, ri) => (
                    <div
                      key={row.feature}
                      className={`grid grid-cols-[1fr_auto_auto] sm:grid-cols-[1fr_140px_140px] transition-colors ${
                        ri % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                      } ${ci === categories.length - 1 && ri === data.featureRows.filter(f => f.category === cat).length - 1 ? '' : 'border-b border-gray-100'}`}
                    >
                      <div className="px-5 py-3 flex items-center gap-2">
                        <span className="text-sm text-gray-700">{row.feature}</span>
                        {row.note && (
                          <span className="text-[10px] text-gray-400 hidden sm:inline">({row.note})</span>
                        )}
                      </div>
                      <div className="px-4 py-3 flex items-center justify-center border-l border-gray-100 bg-blue-600/[0.03]">
                        <Cell value={row.pp} primary />
                      </div>
                      <div className="px-4 py-3 flex items-center justify-center border-l border-gray-100">
                        <Cell value={row.them} />
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="flex items-center gap-4 mt-4 px-1">
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <span className="inline-flex w-4 h-4 items-center justify-center rounded-full bg-blue-600"><Check size={9} className="text-white" strokeWidth={3} /></span>
                Available
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <span className="inline-flex w-4 h-4 items-center justify-center rounded-full bg-yellow-100"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400" /></span>
                Partial
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <span className="inline-flex w-4 h-4 items-center justify-center rounded-full bg-gray-50"><X size={9} className="text-gray-300" strokeWidth={3} /></span>
                Not available
              </div>
            </div>
          </div>
        </section>

        {/* ── Why ProfilePush wins ── */}
        <section className="bg-gray-50 border-b border-gray-100 py-12 md:py-16">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-10">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Why recruiters switch</p>
              <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900">3 reasons ProfilePush wins</h2>
            </div>
            <div className="grid sm:grid-cols-3 gap-5">
              {data.differentiators.map((d, i) => (
                <div key={i} className="bg-white rounded-2xl border border-gray-200 p-6">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center mb-4">
                    <d.icon size={17} className="text-blue-600" />
                  </div>
                  <h3 className="text-base font-extrabold text-gray-900 mb-2">{d.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{d.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Verdict ── */}
        <section className="bg-white border-b border-gray-100 py-12 md:py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <div className="inline-flex items-center gap-1.5 bg-yellow-50 border border-yellow-100 text-yellow-700 text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full mb-5">
              <Star size={11} /> Our verdict
            </div>
            <p className="text-lg md:text-xl font-semibold text-gray-800 leading-relaxed">
              "{data.verdict}"
            </p>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="bg-gray-50 border-b border-gray-100 py-12 md:py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <div className="text-center mb-8">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Common questions</p>
              <h2 className="text-2xl font-extrabold text-gray-900">ProfilePush vs {data.name} FAQ</h2>
            </div>
            <div className="flex flex-col gap-3">
              {data.faqs.map((faq, i) => (
                <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="text-sm font-extrabold text-gray-900 mb-2">{faq.q}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{faq.a}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="bg-white py-16 md:py-24">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="text-2xl md:text-3xl font-extrabold text-gray-900 mb-4">
              Ready to see the difference?
            </h2>
            <p className="text-gray-500 text-base mb-8">
              Join bench sales recruiters and vendor teams who use ProfilePush to source faster, match smarter, and close more placements — starting today.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link
                to="/signup"
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3.5 rounded-xl transition-colors shadow-sm shadow-blue-200"
              >
                Start free — no credit card <ArrowRight size={15} />
              </Link>
              <Link
                to="/#pricing"
                className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                View pricing
              </Link>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
