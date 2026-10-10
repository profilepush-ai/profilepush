import { Link, useParams, Navigate } from 'react-router-dom';
import { Check, X, ArrowRight, Zap, Target, Users, Search, Brain, FileText, Activity, Star, ChevronRight } from 'lucide-react';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import MarketingNav from '../components/MarketingNav';

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
  { category: 'Matching', feature: 'AI Match: paste a consultant or a requirement, get ranked matches', pp: true, them: false },
  { category: 'Matching', feature: 'Live requirement feed (Jobs)', pp: true, them: false },
  { category: 'Matching', feature: 'Live available-consultant feed (Hotlist)', pp: true, them: false },
  { category: 'Matching', feature: 'New requirements and consultants every day', pp: true, them: 'partial' },
  { category: 'Outreach', feature: 'AI-written submission email, sent from your own Gmail', pp: true, them: false },
  { category: 'Outreach', feature: 'Consultant resume attached automatically', pp: true, them: false },
  { category: 'Outreach', feature: 'One-tap resume, rate and availability request (AI Request)', pp: true, them: false },
  { category: 'Outreach', feature: 'Bulk send to many matches at once', pp: true, them: 'partial' },
  { category: 'Tracker', feature: 'Live Tracker: a column of matches per consultant or requirement', pp: true, them: false },
  { category: 'Tracker', feature: 'Alerts when strong new matches land', pp: true, them: false },
  { category: 'Team', feature: 'Multi-user team workspace', pp: true, them: 'partial' },
  { category: 'Team', feature: 'Built for both sides of the desk (bench sales + vendor teams)', pp: true, them: false },
  { category: 'Team', feature: 'Purpose-built for US IT staffing', pp: true, them: false },
  { category: 'Pricing', feature: 'Free forever plan', pp: true, them: false },
  { category: 'Pricing', feature: 'No per-user pricing and no subscription', pp: true, them: false },
];

const FEATURES_CEIPAL: FeatureRow[] = FEATURES.map(f => {
  if (f.feature === 'Multi-user team workspace') return { ...f, them: true };
  return f;
});

const FEATURES_JOBRIGHT: FeatureRow[] = FEATURES.map(f => {
  if (f.feature === 'Multi-user team workspace') return { ...f, them: false };
  if (f.feature === 'Live requirement feed (Jobs)') return { ...f, them: 'partial', note: 'For job seekers, not recruiters' };
  return f;
});

const FEATURES_APPLYNXT: FeatureRow[] = FEATURES.map(f => {
  if (f.feature === 'Multi-user team workspace') return { ...f, them: false };
  if (f.feature === 'Bulk send to many matches at once') return { ...f, them: 'partial', note: 'Mass-applies for one job seeker' };
  return f;
});

const COMPETITORS: Record<string, Competitor & { featureRows: FeatureRow[] }> = {
  ceipal: {
    slug: 'ceipal',
    name: 'Ceipal',
    tagline: 'Enterprise ATS & Staffing Platform',
    whatItIs: 'Ceipal is a broad applicant tracking system built for staffing agencies — covering onboarding, compliance, payroll integrations, and candidate pipelines. It does a lot, but it wasn\'t built for the day-to-day matching and outreach that bench sales recruiters and vendor teams run every day.',
    heroHeadline: 'ProfilePush vs Ceipal',
    heroSub: 'Ceipal manages your ATS pipeline. ProfilePush fills it — paste a consultant or a requirement, get ranked matches, and the email writes itself. Every new match then lands in your live Tracker, all day.',
    accentColor: 'text-blue-600',
    accentBg: 'bg-blue-50',
    verdict: 'Ceipal is an enterprise ATS. ProfilePush is the AI copilot that feeds it — matching and outreach for both bench sales recruiters and vendor teams. The two solve different problems, but if your bottleneck is finding and reaching the right person faster, ProfilePush is the clear choice.',
    differentiators: [
      {
        icon: Search,
        title: 'Matches that come to you.',
        body: 'Ceipal shows the pipeline you already have. ProfilePush brings new requirements and consultants every day and matches them to what you posted, so the right ones land in your Tracker without searching.',
      },
      {
        icon: Brain,
        title: 'The email writes itself.',
        body: 'Ceipal leaves outreach to you. ProfilePush writes the submission email from the match, attaches the consultant\'s resume, and sends it from your own Gmail in one click — one at a time or in bulk.',
      },
      {
        icon: Target,
        title: 'Built for both sides of the desk.',
        body: 'Ceipal serves every vertical the same way. ProfilePush is purpose-built for US IT staffing — a column per consultant for bench sales, a column per requirement for vendors.',
      },
    ],
    faqs: [
      { q: 'Can I use ProfilePush alongside Ceipal?', a: 'Yes. ProfilePush handles matching and outreach — AI Match, the Jobs and Hotlist feeds, AI Submit and the Tracker — while you continue managing compliance, payroll, and contracts in Ceipal. They complement each other well.' },
      { q: 'Is ProfilePush cheaper than Ceipal?', a: 'ProfilePush is free to start with 100 matches, then ₹0.25 a match in India or $0.01 elsewhere (any amount from ₹100 or $5, no subscription), with unlimited users on every plan. Ceipal is priced as enterprise ATS software and typically costs significantly more per seat.' },
      { q: 'Does Ceipal bring new requirements to me?', a: 'Ceipal is built around managing your own postings and pipeline. ProfilePush adds new requirements and consultants every day and matches them to the consultants or requirements you posted, live.' },
    ],
    featureRows: FEATURES_CEIPAL,
  },

  'jobright-ai': {
    slug: 'jobright-ai',
    name: 'Jobright.ai',
    tagline: 'AI Job Search Platform for Job Seekers',
    whatItIs: 'Jobright.ai is an AI tool designed to help individual job seekers find and track job opportunities for themselves. It\'s a job-seeker tool, not a recruiter or vendor-team tool — it has no concept of a bench, an open requirement, or a client relationship.',
    heroHeadline: 'ProfilePush vs Jobright.ai',
    heroSub: 'Jobright.ai helps a candidate find a job for themselves. ProfilePush is built for the other side of the desk — bench sales recruiters matching consultants to requirements and vendor teams finding consultants — with the email written for you.',
    accentColor: 'text-orange-600',
    accentBg: 'bg-orange-50',
    verdict: 'Jobright.ai and ProfilePush serve opposite ends of the same pipeline. If you\'re a recruiter or vendor team managing a bench or a requirement, ProfilePush was built for exactly what you do — Jobright.ai was not.',
    differentiators: [
      {
        icon: Users,
        title: 'Built for staffing desks, not solo job seekers.',
        body: 'Jobright.ai is a self-serve tool for one person tracking their own applications. ProfilePush is for bench sales recruiters and vendor teams running many consultants and many requirements at once, each with its own live column of matches.',
      },
      {
        icon: Search,
        title: 'Two-sided matching, not one-sided search.',
        body: 'Jobright.ai matches jobs to a single candidate\'s resume. ProfilePush runs both directions — requirements matched to your bench, and available consultants matched to your open requirements.',
      },
      {
        icon: FileText,
        title: 'Outreach built in, not left to you.',
        body: 'Jobright.ai stops at showing you a job. ProfilePush writes the email — a submission with the resume attached, or a request for a consultant\'s resume, rate and availability — and sends it from your Gmail.',
      },
    ],
    faqs: [
      { q: 'Is Jobright.ai useful for recruiters or vendor teams?', a: 'Jobright.ai is built for individual job seekers managing their own search. It has no workspace for a recruiting team and no concept of sourcing candidates for someone else.' },
      { q: 'What does ProfilePush do that Jobright.ai cannot?', a: 'ProfilePush gives a staffing team AI Match, live Jobs and Hotlist feeds, AI-written submissions and resume requests sent from your Gmail, and a live Tracker with a column of matches for every consultant or requirement.' },
      { q: 'Is there a recruiter version of Jobright.ai?', a: 'Not currently — Jobright.ai is positioned squarely as a job-seeker product. ProfilePush was built from the ground up for the recruiter and vendor-team side of the same pipeline.' },
    ],
    featureRows: FEATURES_JOBRIGHT,
  },

  'drivetube-ai': {
    slug: 'drivetube-ai',
    name: 'DriveTube.ai',
    tagline: 'AI Recruiting Assistant',
    whatItIs: 'DriveTube.ai is an AI-powered recruiting assistant aimed at streamlining parts of the hiring workflow. It applies AI to general recruiting tasks, but it lacks the IT-staffing-specific depth — two-sided bench and requirement matching, a live Tracker, and outreach written for staffing — that US IT staffing desks run on.',
    heroHeadline: 'ProfilePush vs DriveTube.ai',
    heroSub: 'DriveTube.ai brings general AI to recruiting workflows. ProfilePush brings AI to the specific US IT staffing loop — paste a consultant or a requirement, get ranked matches, send the email, and follow every new match live.',
    accentColor: 'text-blue-600',
    accentBg: 'bg-blue-50',
    verdict: 'DriveTube.ai covers recruiting AI broadly. ProfilePush goes deep on what US IT staffing teams need most — matching and outreach built specifically for bench sales recruiters and vendor teams.',
    differentiators: [
      {
        icon: Search,
        title: 'New matches every day, for what you posted.',
        body: 'ProfilePush brings new requirements and consultants every day and matches them to each consultant or requirement you posted. Strong new matches arrive in your Tracker with an alert.',
      },
      {
        icon: Brain,
        title: 'Matching that understands both sides.',
        body: 'ProfilePush is built around the two real IT-staffing workflows: filling your bench with requirements, and filling a requirement with a consultant. A generic recruiting assistant isn\'t built around that split.',
      },
      {
        icon: Activity,
        title: 'A live board, not a to-do list.',
        body: 'The Tracker gives every consultant or requirement its own column of matches, newest first. Send AI Submit or AI Request from the card, in bulk if you like, and the card moves to Submitted.',
      },
    ],
    faqs: [
      { q: 'How is ProfilePush different from DriveTube.ai?', a: 'ProfilePush is purpose-built for US IT staffing — two-sided AI matching, AI-written submissions and resume requests sent from your Gmail, and a live Tracker with a column of matches per consultant or requirement.' },
      { q: 'Does ProfilePush bring new leads to me?', a: 'Yes. New requirements and consultants arrive every day and are matched to what you posted, live. You get a notification when strong matches land.' },
      { q: 'Which tool is better for offshore staffing teams?', a: 'ProfilePush is built for offshore bench sales and vendor teams working US placements — the whole team shares one workspace and one credit balance, with no per-user pricing.' },
    ],
    featureRows: FEATURES,
  },

  'apply-nxt': {
    slug: 'apply-nxt',
    name: 'Apply.nxt',
    tagline: 'Automated Job Application Platform',
    whatItIs: 'Apply.nxt automates the job application process for individuals — helping a job seeker submit applications to many jobs quickly. Like Jobright.ai, it\'s a job-seeker automation tool, not a recruiter or vendor-team platform — it has no bench and no two-sided matching.',
    heroHeadline: 'ProfilePush vs Apply.nxt',
    heroSub: 'Apply.nxt automates applying to jobs for one person. ProfilePush automates the recruiter\'s and vendor team\'s side of the same pipeline — matching and reaching out — built for US IT staffing.',
    accentColor: 'text-orange-600',
    accentBg: 'bg-orange-50',
    verdict: 'Apply.nxt solves auto-applying for job seekers. ProfilePush solves the staffing desk\'s end of the same pipeline — finding the right requirements or consultants, and reaching out with AI, without losing track of a match.',
    differentiators: [
      {
        icon: Users,
        title: 'The staffing desk\'s side of the pipeline.',
        body: 'Apply.nxt helps one candidate send out applications en masse. ProfilePush helps the recruiter or vendor team behind them — ranked matches, and an email written for each one.',
      },
      {
        icon: Target,
        title: 'Built for two-sided matching, not mass apply.',
        body: 'Mass applying is a job seeker\'s strategy. Staffing desks win by matching the right consultant to the right requirement — and that\'s what ProfilePush ranks for you.',
      },
      {
        icon: Activity,
        title: 'A live Tracker for every consultant.',
        body: 'Apply.nxt tracks one person\'s applications. ProfilePush gives each of your consultants or requirements a live column of matches, with what you sent to each one.',
      },
    ],
    faqs: [
      { q: 'Is Apply.nxt built for recruiters or vendor teams?', a: 'No. Apply.nxt automates job applications for individual job seekers. It has no workspace or matching built for a staffing team.' },
      { q: 'Can ProfilePush replace Apply.nxt for my candidates?', a: 'ProfilePush handles the staffing desk\'s side — matching requirements and consultants, writing the outreach, and following every match in the Tracker. It\'s a different tool solving a different half of the pipeline.' },
      { q: 'What makes ProfilePush better for US IT staffing?', a: 'ProfilePush matches requirements and consultants both ways, writes and sends the email from your Gmail with the resume attached, and keeps every new match live in the Tracker — all in one workspace built for bench sales recruiters and vendor teams.' },
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

// ── Main page ──────────────────────────────────────────────────────────────────
export default function ComparisonPage() {
  const { competitor } = useParams<{ competitor: string }>();
  const data = competitor ? COMPETITORS[competitor] : null;

  if (!data) return <Navigate to="/" replace />;

  const categories = [...new Set(data.featureRows.map(f => f.category))];

  const canonicalUrl = `https://profilepush.ai/vs/${data.slug}`;
  const metaTitle = `ProfilePush vs ${data.name} — Which Is Better for US IT Staffing Teams?`;
  const metaDesc = `Compare ProfilePush and ${data.name} side by side for US IT staffing — AI-matched requirements and consultants, AI-written outreach from your Gmail, and a live Tracker, built for bench sales recruiters and vendor teams.`;

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
      <MarketingNav />

      <main className="pt-16">
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
