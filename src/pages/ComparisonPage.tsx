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
  { category: 'Search', feature: 'LinkedIn job search', pp: true, them: false },
  { category: 'Search', feature: 'Dice.com job search', pp: true, them: false },
  { category: 'Search', feature: 'Indeed job search', pp: true, them: false },
  { category: 'Search', feature: 'Monster job search', pp: true, them: false },
  { category: 'Search', feature: 'CareerBuilder job search', pp: true, them: false },
  { category: 'Search', feature: 'All 5 boards in one search', pp: true, them: false },
  { category: 'AI', feature: 'AI resume parsing from PDF', pp: true, them: false },
  { category: 'AI', feature: 'AI job match scoring (%)', pp: true, them: false },
  { category: 'AI', feature: 'AI resume rewriting', pp: true, them: false },
  { category: 'AI', feature: 'AI search idea generation', pp: true, them: false },
  { category: 'Recruiting', feature: 'Candidate bench management', pp: true, them: 'partial' },
  { category: 'Recruiting', feature: 'Submission tracking', pp: true, them: 'partial' },
  { category: 'Recruiting', feature: 'Activity timeline per candidate', pp: true, them: false },
  { category: 'Recruiting', feature: 'Candidate onboarding link', pp: true, them: false },
  { category: 'Recruiting', feature: 'Apply confirmation tracking', pp: true, them: false },
  { category: 'Team', feature: 'Multi-user team workspace', pp: true, them: 'partial' },
  { category: 'Team', feature: 'Team usage analytics', pp: true, them: false },
  { category: 'Team', feature: 'Built for Bench Sales (C2C/W2/1099)', pp: true, them: false },
  { category: 'Pricing', feature: 'Starts under $30/month', pp: true, them: false },
  { category: 'Pricing', feature: 'No per-user forced upsells', pp: true, them: false },
];

const FEATURES_CEIPAL: FeatureRow[] = FEATURES.map(f => {
  if (f.feature === 'Candidate bench management') return { ...f, them: 'partial' };
  if (f.feature === 'Submission tracking') return { ...f, them: true };
  if (f.feature === 'Multi-user team workspace') return { ...f, them: true };
  if (f.feature === 'AI resume parsing from PDF') return { ...f, them: 'partial' };
  return f;
});

const FEATURES_JOBRIGHT: FeatureRow[] = FEATURES.map(f => {
  if (f.feature === 'AI job match scoring (%)') return { ...f, them: 'partial', note: 'Job-seeker side only' };
  if (f.feature === 'AI search idea generation') return { ...f, them: 'partial' };
  return f;
});

const COMPETITORS: Record<string, Competitor & { featureRows: FeatureRow[] }> = {
  ceipal: {
    slug: 'ceipal',
    name: 'Ceipal',
    tagline: 'Enterprise ATS & Staffing Platform',
    whatItIs: 'Ceipal is a broad applicant tracking system built for staffing agencies — covering onboarding, compliance, payroll integrations, and candidate pipelines. It does a lot, but its AI layer is shallow and it wasn\'t built with Bench Sales recruiters\' day-to-day sourcing workflow in mind.',
    heroHeadline: 'ProfilePush vs Ceipal',
    heroSub: 'Ceipal manages your ATS pipeline. ProfilePush fills it — with AI job search across 5 boards, match scoring, and instant resume rewrites built specifically for Bench Sales recruiters.',
    accentColor: 'text-blue-600',
    accentBg: 'bg-blue-50',
    verdict: 'Ceipal is an enterprise ATS. ProfilePush is a recruiter\'s AI sourcing engine. The two solve different problems — but if your bottleneck is finding and qualifying candidates faster, ProfilePush is the clear choice.',
    differentiators: [
      {
        icon: Search,
        title: '5 boards. One click.',
        body: 'Ceipal doesn\'t search LinkedIn, Dice, Indeed, Monster, and CareerBuilder simultaneously. ProfilePush does — from one query. Stop toggling tabs and start closing roles.',
      },
      {
        icon: Brain,
        title: 'Real AI scoring, not keyword filters.',
        body: 'Ceipal offers basic resume matching. ProfilePush gives you a percentage match score, skill gap analysis, and AI-written rewrite suggestions — before you ever call the candidate.',
      },
      {
        icon: Target,
        title: 'Built for Bench Sales. Not just staffing.',
        body: 'Ceipal serves every vertical. ProfilePush is purpose-built for Bench Sales recruiters placing C2C, W2, and 1099 technology professionals. Every feature was designed for that workflow.',
      },
    ],
    faqs: [
      { q: 'Can I use ProfilePush alongside Ceipal?', a: 'Yes. ProfilePush handles the sourcing and qualification layer — search, match, rewrite — and you can continue managing pipeline, compliance, and contracts in Ceipal. They complement each other well.' },
      { q: 'Is ProfilePush cheaper than Ceipal?', a: 'ProfilePush starts at $29/month for up to 3 users. Ceipal pricing starts significantly higher and scales with seat count. For small to mid-size Bench Sales desks, ProfilePush delivers a better ROI at a fraction of the cost.' },
      { q: 'Does Ceipal search multiple job boards at once?', a: 'No. Ceipal has job board integrations for posting, but it does not run simultaneous active searches across LinkedIn, Dice, Indeed, Monster, and CareerBuilder the way ProfilePush does.' },
    ],
    featureRows: FEATURES_CEIPAL,
  },

  'jobright-ai': {
    slug: 'jobright-ai',
    name: 'Jobright.ai',
    tagline: 'AI Job Search Platform for Job Seekers',
    whatItIs: 'Jobright.ai is an AI tool designed to help job seekers find and track job opportunities. It aggregates listings, scores them against a candidate\'s own resume, and helps individuals manage their own job applications. It is a job seeker tool — not a recruiter tool.',
    heroHeadline: 'ProfilePush vs Jobright.ai',
    heroSub: 'Jobright.ai helps candidates find jobs for themselves. ProfilePush gives recruiters the AI engine to find, match, and place those candidates — faster than any tool in the market.',
    accentColor: 'text-orange-600',
    accentBg: 'bg-orange-50',
    verdict: 'Jobright.ai and ProfilePush serve opposite ends of the same pipeline. If you are a recruiter managing a bench of candidates, ProfilePush was built for exactly what you do — Jobright.ai was not.',
    differentiators: [
      {
        icon: Users,
        title: 'Built for recruiters, not candidates.',
        body: 'Jobright.ai is a self-serve tool for job seekers tracking their own applications. ProfilePush is for recruiters managing multiple candidates, multiple clients, and multiple job boards simultaneously.',
      },
      {
        icon: Search,
        title: 'Recruiter-grade multi-board search.',
        body: 'Jobright.ai aggregates jobs passively. ProfilePush actively searches LinkedIn, Dice, Indeed, Monster, and CareerBuilder on your behalf — with IT-specific filters and AI scoring per candidate.',
      },
      {
        icon: FileText,
        title: 'Rewrite resumes for your candidates.',
        body: 'Jobright.ai can help a job seeker polish their own resume. ProfilePush lets you rewrite your candidate\'s resume to match a specific job — instantly, from within the placement workflow.',
      },
    ],
    faqs: [
      { q: 'Is Jobright.ai useful for recruiters?', a: 'Jobright.ai is primarily designed for individual job seekers managing their personal job search. It was not built for staffing professionals placing multiple candidates across multiple roles simultaneously.' },
      { q: 'What does ProfilePush do that Jobright.ai cannot?', a: 'ProfilePush manages a full candidate bench, runs simultaneous searches across 5 job boards per candidate, AI-scores every job against a candidate profile, rewrites resumes on demand, and logs every activity for your team — none of which Jobright.ai offers for recruiters.' },
      { q: 'Is there a recruiter version of Jobright.ai?', a: 'As of now, Jobright.ai does not offer a dedicated recruiter or staffing agency product. ProfilePush was built from the ground up for exactly that use case.' },
    ],
    featureRows: FEATURES_JOBRIGHT,
  },

  'drivetube-ai': {
    slug: 'drivetube-ai',
    name: 'DriveTube.ai',
    tagline: 'AI Recruiting Assistant',
    whatItIs: 'DriveTube.ai is an AI-powered recruiting assistant aimed at streamlining parts of the hiring workflow. While it applies AI to candidate screening tasks, it lacks the deep Bench Sales specificity, multi-board sourcing engine, and end-to-end placement workflow that Bench Sales recruiters need.',
    heroHeadline: 'ProfilePush vs DriveTube.ai',
    heroSub: 'DriveTube.ai brings AI to recruiting workflows. ProfilePush brings AI to the full Bench Sales lifecycle — five-board search, match scoring, resume rewriting, and candidate placement in one place.',
    accentColor: 'text-blue-600',
    accentBg: 'bg-blue-50',
    verdict: 'DriveTube.ai covers recruiting AI broadly. ProfilePush goes deep on what Bench Sales recruiters need most — sourcing, matching, and placing technology professionals at speed and scale.',
    differentiators: [
      {
        icon: Search,
        title: 'Sourcing depth no general tool matches.',
        body: 'ProfilePush searches LinkedIn, Dice, Indeed, Monster, and CareerBuilder simultaneously — the five platforms where IT contracts are actually posted. Most AI recruiting tools don\'t come close to this coverage.',
      },
      {
        icon: Brain,
        title: 'Match scoring tuned for IT skills.',
        body: 'AI match scoring in ProfilePush understands tech stacks, frameworks, certifications, and contract types (C2C, W2, 1099) — not just generic keyword overlap that most AI tools default to.',
      },
      {
        icon: Activity,
        title: 'Every action logged. Every output visible.',
        body: 'ProfilePush logs every search, match, and submission timestamped per recruiter. Your team\'s output is measurable and provable — no standups required.',
      },
    ],
    faqs: [
      { q: 'How is ProfilePush different from DriveTube.ai?', a: 'ProfilePush is purpose-built for Bench Sales — with simultaneous multi-board job search, IT-aware AI match scoring, AI resume rewriting, and end-to-end candidate bench management. It solves the full placement workflow, not just one part of it.' },
      { q: 'Does DriveTube.ai search multiple job boards?', a: 'DriveTube.ai focuses on AI-assisted recruiting tasks but does not offer the kind of simultaneous 5-board job search engine that ProfilePush provides to Bench Sales recruiters.' },
      { q: 'Which tool is better for offshore Bench Sales teams?', a: 'ProfilePush is specifically designed for offshore Bench Sales recruiting pods managing US placements. Every search, match, and activity is logged and timestamped, giving full visibility to team output across time zones.' },
    ],
    featureRows: FEATURES,
  },

  'apply-nxt': {
    slug: 'apply-nxt',
    name: 'Apply.nxt',
    tagline: 'Automated Job Application Platform',
    whatItIs: 'Apply.nxt automates the job application process — helping individuals submit applications to many jobs quickly. Like Jobright.ai, it is a job seeker automation tool, not a recruiter platform. It does not offer candidate management, multi-board sourcing, or AI match scoring for staffing professionals.',
    heroHeadline: 'ProfilePush vs Apply.nxt',
    heroSub: 'Apply.nxt automates applying to jobs. ProfilePush automates finding, qualifying, and placing candidates — the full workflow a Bench Sales recruiter actually needs.',
    accentColor: 'text-orange-600',
    accentBg: 'bg-orange-50',
    verdict: 'Apply.nxt solves auto-applying for job seekers. ProfilePush solves the recruiter\'s end of the same pipeline — finding the right jobs, qualifying candidates with AI, and tracking every placement from search to submission.',
    differentiators: [
      {
        icon: Users,
        title: 'The recruiter\'s side of the pipeline.',
        body: 'Apply.nxt helps candidates send out applications en masse. ProfilePush helps you — the recruiter — identify the right roles, score fit with AI, rewrite the resume, and submit a qualified candidate to a client.',
      },
      {
        icon: Target,
        title: 'Quality over volume.',
        body: 'Mass applying is the job seeker\'s strategy. Recruiters win on qualified submissions. ProfilePush gives you AI match scores, skill gap reports, and rewritten resumes — so every submission you make is a confident one.',
      },
      {
        icon: Activity,
        title: 'Manage an entire candidate bench.',
        body: 'Apply.nxt tracks one person\'s applications. ProfilePush lets you manage a full bench of candidates — each with their own profile, resume, wishlist, and submission history — all in one workspace.',
      },
    ],
    faqs: [
      { q: 'Is Apply.nxt built for recruiters?', a: 'No. Apply.nxt is a job seeker tool that automates the job application process for individuals. It is not designed for staffing agencies or recruiting professionals managing multiple candidates.' },
      { q: 'Can ProfilePush replace Apply.nxt for my candidates?', a: 'ProfilePush handles the recruiter side of placements — finding jobs, scoring matches, rewriting resumes, and tracking submissions. Candidates can receive their confirm-applied links directly from your ProfilePush workflow.' },
      { q: 'What makes ProfilePush better for Bench Sales?', a: 'ProfilePush searches the five job boards where IT contracts are actually posted (LinkedIn, Dice, Indeed, Monster, CareerBuilder), scores every match with IT-aware AI, and rewrites resumes to align with specific tech stack requirements — all in one workflow.' },
    ],
    featureRows: FEATURES,
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
  const metaTitle = `ProfilePush vs ${data.name} — Which is Better for Bench Sales Recruiters?`;
  const metaDesc = `Compare ProfilePush and ${data.name} side by side. See which platform wins on AI job search, match scoring, resume rewriting, and Bench Sales features.`;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: metaTitle,
    description: metaDesc,
    url: canonicalUrl,
    publisher: { '@id': 'https://profilepush.ai/#organization' },
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
              Join Bench Sales teams who use ProfilePush to source faster, match smarter, and close more placements — starting today.
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
