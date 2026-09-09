import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, Plus, Minus, ShieldCheck } from 'lucide-react';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import GifSlot from '../components/GifSlot';
import MarketingNav from '../components/MarketingNav';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type Persona = 'vendor' | 'bench_sales';

interface FeatureEntry {
  key: string;
  slug: string;
  headline: string;
  subline: string;
  note?: string;
  accent: string;
  badge: string;
  badgeLabel: string;
  topGlow: string;
}

interface HowItWorksStep {
  n: string;
  t: string;
  d: string;
  dot: string;
  num: string;
  ring: string;
}

interface FaqPair { q: string; a: string; }

interface ProblemBlock { eyebrow: string; headline: string; body: string; }

interface PersonaContent {
  title: string;
  description: string;
  canonical: string;
  heroHeadline: string;
  heroSub?: string;
  heroFeatureKey: string;
  problem?: ProblemBlock;
  features: FeatureEntry[];
  workflowEyebrow?: string;
  workflowHeading?: string;
  howItWorks: HowItWorksStep[];
  workflowClosing?: string;
  pricingHeading?: string;
  pricingBody?: string;
  freeBullets?: string[];
  proBullets?: string[];
  faq: FaqPair[];
  ctaHeadlineLine1: string;
  ctaHeadlineLine2?: string;
  ctaSub: string;
}

const PERSONA_CONTENT: Record<Persona, PersonaContent> = {
  vendor: {
    title: 'ProfilePush for Vendors — AI Video Screening Catches Fake Resumes & Proxies',
    description: 'ProfilePush is the AI copilot for Vendor teams. Every job applicant completes a recorded, adaptive AI video interview before you review them — built to catch fake resumes and proxy interviews early, before the client ever sees a bad consultant.',
    canonical: 'https://profilepush.ai/vendors',
    heroHeadline: 'The AI Copilot that finds fake resumes and proxies early.',
    heroFeatureKey: 'screening',
    features: [
      {
        key: 'screening',
        slug: 'screening',
        headline: 'The copilot interviews first.',
        subline: 'The consultant answers questions on video. Each new question comes from the last answer. The copilot asks for a real number, a real tool, a real project. A fake resume will not pass. A proxy cannot hide on video. The recording, the score and the summary all arrive before the client sees anyone.',
        accent: 'from-rose-50 to-white',
        badge: 'bg-rose-100 text-rose-700',
        badgeLabel: 'Screening',
        topGlow: 'rgba(253,164,175,0.5)',
      },
      {
        key: 'posts',
        slug: 'post-a-job',
        headline: 'The copilot fills the form.',
        subline: 'Paste the req exactly as it would go into a group. The copilot pulls out the skills, visa, rate and experience.',
        accent: 'from-teal-50 to-white',
        badge: 'bg-teal-100 text-teal-700',
        badgeLabel: 'Post a Job',
        topGlow: 'rgba(94,234,212,0.5)',
      },
      {
        key: 'hotlist',
        slug: 'hotlist',
        headline: 'The copilot watches every group.',
        subline: 'LinkedIn, Facebook, WhatsApp and job boards. All day, every day. Consultants appear the day they become available.',
        accent: 'from-amber-50 to-white',
        badge: 'bg-amber-100 text-amber-700',
        badgeLabel: 'Hotlist',
        topGlow: 'rgba(252,211,77,0.5)',
      },
      {
        key: 'inbox',
        slug: 'ai-outreach',
        headline: 'The copilot writes the email.',
        subline: 'Each email is about that one consultant. It sends from a real Gmail address. One click to approve. All replies arrive in one place.',
        accent: 'from-purple-50 to-white',
        badge: 'bg-purple-100 text-purple-700',
        badgeLabel: 'AI Outreach',
        topGlow: 'rgba(216,180,254,0.5)',
      },
      {
        key: 'tracker',
        slug: 'tracker',
        headline: 'The copilot keeps every record.',
        subline: 'Every request sent. Every reply received. Every resume downloaded. Nothing is asked twice.',
        accent: 'from-emerald-50 to-white',
        badge: 'bg-emerald-100 text-emerald-700',
        badgeLabel: 'Tracker',
        topGlow: 'rgba(110,231,183,0.5)',
      },
      {
        key: 'activelist',
        slug: 'active-list',
        headline: 'The copilot updates the list daily.',
        subline: 'Every bench sales recruiter posting right now. Filter by skill, visa, experience, rate and location.',
        accent: 'from-sky-50 to-white',
        badge: 'bg-sky-100 text-sky-700',
        badgeLabel: 'Active List',
        topGlow: 'rgba(125,211,252,0.5)',
      },
    ],
    workflowEyebrow: 'The Workflow',
    workflowHeading: 'What the copilot does in the background.',
    howItWorks: [
      { n: '1', t: 'Watches', d: 'every group and job board for available consultants', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
      { n: '2', t: 'Fills', d: 'the req form, from pasted text', dot: 'bg-indigo-500', num: 'text-indigo-500', ring: 'ring-indigo-100' },
      { n: '3', t: 'Writes', d: 'a resume request email, sent from a real inbox', dot: 'bg-purple-500', num: 'text-purple-500', ring: 'ring-purple-100' },
      { n: '4', t: 'Interviews', d: 'every consultant on video, with a score and a summary', dot: 'bg-rose-500', num: 'text-rose-500', ring: 'ring-rose-100' },
    ],
    workflowClosing: 'The vendor: submits only the consultants who are ready for the client.',
    faq: [
      { q: 'How does this stop proxy interviews?', a: 'The interview is on video and recorded. Each question is based on the last answer. Nobody can prepare a script in advance. The person on the client call is the same person on the recording.' },
      { q: 'How does it find a fake resume?', a: 'The first question comes from the resume itself. Every next question asks for details. A real number. A real tool. A real project. False claims fail in ninety seconds.' },
      { q: 'Does every consultant get screened?', a: 'Yes. Every submission arrives with a video interview, a score from 0 to 100, and a short written summary. The summary lists both good points and problems.' },
      { q: 'What costs credits?', a: 'A post costs 1 credit. An AI email costs 1 credit, refunded if it fails. A finished screening costs 50 credits, charged to the req owner. Editing is free.' },
      { q: 'Is the data safe?', a: 'Yes. All data is encrypted. It is never sold or shared. Emails send from a connected Gmail address.' },
    ],
    ctaHeadlineLine1: 'Protect the client relationship.',
    ctaSub: 'Let the copilot interview first.',
  },
  bench_sales: {
    title: 'ProfilePush for Bench Sales — Connect Your Bench to Prime Vendors',
    description: 'ProfilePush is the AI copilot for Bench Sales recruiters. Find the vendors actually posting requirements right now, post your whole bench in one paste, and submit candidates for free — with no limit.',
    canonical: 'https://profilepush.ai/bench-sales',
    heroHeadline: 'The AI Copilot that connects the bench to prime vendors.',
    heroFeatureKey: 'activelist',
    features: [
      {
        key: 'activelist',
        slug: 'prime-vendors',
        headline: 'The copilot finds the vendors who are actually posting.',
        subline: 'A live list of every vendor posting reqs right now. Filter by skill, rate, visa, work type and location. Each filter shows a live count. No old lists. No dead contacts. Download up to 50 vendor contacts per day.',
        accent: 'from-sky-50 to-white',
        badge: 'bg-sky-100 text-sky-700',
        badgeLabel: 'Prime Vendors',
        topGlow: 'rgba(125,211,252,0.5)',
      },
      {
        key: 'pulse',
        slug: 'reqs',
        headline: 'The copilot watches every group, all day.',
        subline: 'LinkedIn, Facebook, WhatsApp groups and job boards. Every new req appears the minute it posts. Filter by skill, rate and visa. Repeated posts are removed automatically. Submit first, not fiftieth.',
        accent: 'from-blue-100 to-white',
        badge: 'bg-blue-100 text-blue-700',
        badgeLabel: 'Reqs',
        topGlow: 'rgba(147,197,253,0.6)',
      },
      {
        key: 'pulse',
        slug: 'submissions',
        headline: 'The copilot fills every submission.',
        subline: 'Upload the resume. The copilot reads the name, email and phone. One click to submit. Nothing is typed twice. Submissions never cost a credit, and there is no limit.',
        accent: 'from-blue-100 to-white',
        badge: 'bg-blue-100 text-blue-700',
        badgeLabel: 'Submissions',
        topGlow: 'rgba(147,197,253,0.6)',
      },
      {
        key: 'posts',
        slug: 'post-the-bench',
        headline: 'The copilot posts the whole bench in one paste.',
        subline: 'Paste the hotlist table exactly as it is. The copilot reads every consultant on it. All of them go live to every vendor at once. Editing is always free.',
        accent: 'from-teal-50 to-white',
        badge: 'bg-teal-100 text-teal-700',
        badgeLabel: 'Post the Bench',
        topGlow: 'rgba(94,234,212,0.5)',
      },
      {
        key: 'hotlist',
        slug: 'inbound-requests',
        headline: 'The copilot collects every resume request.',
        subline: 'When a vendor wants a resume from the hotlist, it appears in one list. Clear status on every request. Upload the resume, add a note, done. No credit charge.',
        accent: 'from-amber-50 to-white',
        badge: 'bg-amber-100 text-amber-700',
        badgeLabel: 'Inbound Requests',
        topGlow: 'rgba(252,211,77,0.5)',
      },
      {
        key: 'tracker',
        slug: 'tracking',
        headline: 'The copilot tracks every submission in one place.',
        subline: 'Status, score, and the vendor\'s answer. All in one view. Always clear which submissions are moving and which need a follow up today.',
        accent: 'from-emerald-50 to-white',
        badge: 'bg-emerald-100 text-emerald-700',
        badgeLabel: 'Tracking',
        topGlow: 'rgba(110,231,183,0.5)',
      },
      {
        key: 'screening',
        slug: 'screening',
        headline: 'The copilot helps every submission get noticed.',
        subline: 'Each submission comes with a short video interview link. The recruiter shares it with the consultant. The vendor then sees a real person, a score and a recording. Submissions with a screening get answered faster than a plain resume.',
        note: 'The copilot never contacts the consultant. The link goes only to the recruiter. No emails, no account, no marketing. Nobody comes between the recruiter and the bench.',
        accent: 'from-rose-50 to-white',
        badge: 'bg-rose-100 text-rose-700',
        badgeLabel: 'Screening',
        topGlow: 'rgba(253,164,175,0.5)',
      },
    ],
    workflowEyebrow: 'The Workflow',
    workflowHeading: 'What the copilot does in the background.',
    howItWorks: [
      { n: '1', t: 'Finds', d: 'the vendors posting reqs right now', dot: 'bg-sky-500', num: 'text-sky-500', ring: 'ring-sky-100' },
      { n: '2', t: 'Watches', d: 'every group and job board for new reqs', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
      { n: '3', t: 'Posts', d: 'the whole bench, from one pasted table', dot: 'bg-indigo-500', num: 'text-indigo-500', ring: 'ring-indigo-100' },
      { n: '4', t: 'Fills', d: 'every submission, straight from the resume', dot: 'bg-purple-500', num: 'text-purple-500', ring: 'ring-purple-100' },
      { n: '5', t: 'Tracks', d: 'every submission and every reply', dot: 'bg-emerald-500', num: 'text-emerald-500', ring: 'ring-emerald-100' },
    ],
    workflowClosing: 'The recruiter: picks the vendors and closes the deal.',
    pricingHeading: 'Free forever. Pro when needed.',
    pricingBody: '500 credits that never expire. Browsing, submitting and editing are always free.',
    freeBullets: [
      'All features included',
      'Unlimited team members',
      '50 vendor contacts per day',
      '1 credit per post or AI email',
    ],
    proBullets: [
      'Everything in Free',
      '500–5,000 credits every month',
      'Credits arrive automatically',
      'Cancel anytime',
    ],
    faq: [
      { q: 'How does the copilot find prime vendors?', a: 'It builds a live list from vendors posting reqs right now. Filter by skill, rate, visa and location. Every filter shows a live count.' },
      { q: 'Can the whole bench be posted at once?', a: 'Yes. Paste the hotlist table. The copilot reads every consultant and posts them all together.' },
      { q: 'What does submitting cost?', a: 'Nothing. Submissions are free and unlimited. Screening credits are charged to the vendor who owns the req.' },
      { q: 'Does the consultant need an account?', a: 'No. And the copilot never contacts them. The screening link goes to the recruiter only.' },
      { q: 'Can recruiters see which skills are in demand?', a: 'Yes. Every live req can be filtered by skill, rate, visa and location, with a live count on each.' },
      { q: 'Is the data safe?', a: 'Yes. All data is encrypted. It is never sold or shared. Vendors get no way to contact the consultants on a hotlist.' },
    ],
    ctaHeadlineLine1: 'Get the bench in front of prime vendors.',
    ctaSub: 'Stop pasting hotlists into forty groups.',
  },
};

function FaqItem({ q, a }: FaqPair) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left gap-4"
        aria-expanded={open}
      >
        <span className="font-semibold text-gray-900 text-sm leading-snug">{q}</span>
        {open ? <Minus size={14} className="shrink-0 text-gray-400" /> : <Plus size={14} className="shrink-0 text-gray-400" />}
      </button>
      {open && (
        <div className="px-5 pb-4 text-sm text-gray-500 leading-relaxed border-t border-gray-50 pt-3">
          {a}
        </div>
      )}
    </div>
  );
}

export default function PersonaLandingTemplate({ persona }: { persona: Persona }) {
  const { user } = useAuth();
  const canEdit = user?.email === 'poornapotluri27@gmail.com';
  const content = PERSONA_CONTENT[persona];
  const faqEntries = content.faq;

  const personaLabel = persona === 'vendor' ? 'Vendors' : 'Bench Sales';
  const pageJsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${content.canonical}#webpage`,
        url: content.canonical,
        name: content.title,
        description: content.description,
        isPartOf: { '@id': 'https://profilepush.ai/#website' },
        about: { '@id': 'https://profilepush.ai/#organization' },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://profilepush.ai/' },
          { '@type': 'ListItem', position: 2, name: personaLabel, item: content.canonical },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqEntries.map(f => ({
          '@type': 'Question',
          name: f.q,
          acceptedAnswer: { '@type': 'Answer', text: f.a },
        })),
      },
    ],
  };

  const storageBaseUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/landing-assets/features`;
  const allKeys = Array.from(new Set([content.heroFeatureKey, ...content.features.map(f => f.key)]));
  const fallbackScreenshots = allKeys.reduce<Record<string, string>>((acc, key) => {
    acc[key] = `${storageBaseUrl}/${key}.webm`;
    return acc;
  }, {});

  const [screenshots, setScreenshots] = useState<Record<string, string>>(fallbackScreenshots);

  useEffect(() => {
    supabase
      .from('landing_screenshots')
      .select('feature_key, image_url')
      .then(({ data, error }) => {
        if (error) {
          console.warn('Failed to load landing screenshots:', error.message);
          return;
        }
        if (data && data.length > 0) {
          const map: Record<string, string> = {};
          data.forEach(r => { map[r.feature_key] = r.image_url; });
          setScreenshots(prev => ({ ...prev, ...map }));
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona]);

  function handleUploaded(key: string, url: string) {
    setScreenshots(prev => ({ ...prev, [key]: url }));
  }

  const heroFeature = content.features.find(f => f.key === content.heroFeatureKey) ?? content.features[0];

  return (
    <div className="min-h-screen bg-white text-gray-900 overflow-x-hidden">
      <main>
        <SEO
          title={content.title}
          description={content.description}
          canonical={content.canonical}
          jsonLd={pageJsonLd}
        />

        <MarketingNav activePersona={persona} />

        {/* ── HERO ── */}
        <section className="relative pt-24 md:pt-20 pb-6 md:pb-12 px-6 text-center overflow-hidden">
          <div className="relative max-w-3xl mx-auto">
            <h1 className={`text-[clamp(2.2rem,7vw,4.5rem)] font-extrabold tracking-[-0.02em] leading-[1.08] ${content.heroSub ? 'mb-5' : 'mb-8'}`}>
              <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">{content.heroHeadline}</span>
            </h1>

            {content.heroSub && (
              <p className="text-base md:text-lg text-gray-500 max-w-2xl mx-auto mb-8 leading-relaxed">
                {content.heroSub}
              </p>
            )}

            <div className="flex flex-col items-center justify-center gap-4">
              <Link
                to="/signup"
                className="bg-blue-600 hover:bg-blue-700 transition-all text-white font-semibold px-8 py-3.5 rounded-xl flex items-center gap-2 text-base w-full sm:w-auto justify-center"
              >
                Start Free <ChevronRight size={16} />
              </Link>
              <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap justify-center">
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                  Forever Free
                </span>
                <span className="text-gray-400">·</span>
                <span>500 Free AI Credits</span>
                <span className="text-gray-400">·</span>
                <span>No Credit Card Required</span>
              </p>
              <div className="hidden sm:flex flex-wrap items-center justify-center gap-2">
                {['AES-256 Encrypted', '100% Privacy-First — Your Data Never Sold'].map(badge => (
                  <span key={badge} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-full">
                    <ShieldCheck size={11} className="text-emerald-500 shrink-0" />
                    {badge}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="relative z-10 mt-8 max-w-6xl mx-auto text-left">
            <GifSlot
              featureKey={heroFeature.key}
              imageUrl={screenshots[heroFeature.key] ?? null}
              canEdit={canEdit}
              onUploaded={handleUploaded}
              accent={heroFeature.accent}
              topGlow={heroFeature.topGlow}
            />
          </div>
        </section>

        {/* ── PROBLEM ── */}
        {content.problem && (
          <section className="py-16 md:py-20 px-6 bg-red-50/50 border-t border-gray-100">
            <div className="max-w-3xl mx-auto text-center">
              <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-4 bg-red-100 text-red-700 w-fit">
                {content.problem.eyebrow}
              </span>
              <h2 className="text-3xl md:text-4xl font-extrabold tracking-[-0.02em] leading-tight text-gray-900 mb-4">
                {content.problem.headline}
              </h2>
              <p className="text-base text-gray-500 leading-relaxed">{content.problem.body}</p>
            </div>
          </section>
        )}

        {/* ── FEATURES ── */}
        <div id="features">
          {content.features.map((f, idx) => (
            <section
              key={f.slug}
              id={f.slug}
              className={`py-16 md:py-20 px-6 border-t border-gray-100 scroll-mt-16 ${idx % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}
            >
              <div className="max-w-6xl mx-auto">
                <div className="text-left mb-10">
                  <span className={`inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-4 ${f.badge} w-fit`}>
                    {f.badgeLabel}
                  </span>
                  <h3 className="text-4xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.08] mb-4">
                    <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">{f.headline}</span>
                  </h3>
                  <p className="text-base text-gray-500 leading-relaxed">{f.subline}</p>
                  {f.note && (
                    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      <span className="font-bold">Important: </span>{f.note}
                    </div>
                  )}
                </div>

                <GifSlot
                  featureKey={f.key}
                  imageUrl={screenshots[f.key] ?? null}
                  canEdit={canEdit}
                  onUploaded={handleUploaded}
                  accent={f.accent}
                  topGlow={f.topGlow}
                />
              </div>
            </section>
          ))}
        </div>

        {/* ── HOW IT WORKS ── */}
        <section id="how-it-works" className="py-24 px-6 bg-white border-y border-gray-100">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-16">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">{content.workflowEyebrow ?? 'The workflow'}</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
                {content.workflowHeading ?? 'From live signal to placement'}
              </h2>
            </div>

            <div className="relative">
              <div className="absolute left-6 top-6 bottom-6 w-px bg-gray-100" />
              <div className="space-y-0">
                {content.howItWorks.map((step) => (
                  <div key={step.n} className="relative flex gap-8 pb-10 last:pb-0">
                    <div className={`relative z-10 w-12 h-12 shrink-0 rounded-full bg-white ring-4 ${step.ring} border border-gray-100 shadow-sm flex items-center justify-center`}>
                      <span className={`text-base font-black ${step.num}`}>{step.n}</span>
                    </div>
                    <div className="mt-[13px] min-w-0">
                      <div className="font-semibold text-gray-900 text-base mb-1">{step.t}</div>
                      <div className="text-sm text-gray-500 leading-relaxed">{step.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {content.workflowClosing && (
              <p className="mt-4 text-center text-base font-semibold text-gray-900 border-t border-gray-100 pt-8">
                {content.workflowClosing}
              </p>
            )}
          </div>
        </section>

        {/* ── PRICING ── */}
        <section id="pricing" className="py-24 px-6 bg-white border-y border-gray-100">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-14">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Pricing</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                {content.pricingHeading ?? 'Simple, transparent pricing.'}
              </h2>
              <p className="text-base text-gray-500 max-w-lg mx-auto leading-relaxed">
                {content.pricingBody ?? 'Start free with credits that never expire. Upgrade to Pro when you want them delivered automatically.'}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
              {/* Free Plan */}
              <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col">
                <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-6 bg-yellow-100 text-yellow-700 w-fit">
                  Free
                </span>
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className="text-5xl font-extrabold text-gray-900">₹0</span>
                  <span className="text-gray-500 text-sm">/ month</span>
                </div>
                <p className="text-xs text-gray-500 mb-8">500 credits, one time · no card required</p>
                <ul className="space-y-3 text-sm text-gray-600 flex-1 mb-8">
                  {(content.freeBullets ?? [
                    'Pulse, Jobs, Hotlist, Posts, Active List, Inbox & Tracker included',
                    'Unlimited team members',
                    'Active List: 50 contacts/download, 500 lifetime',
                    '1 credit per email draft, AI chat draft, or new post',
                  ]).map(item => (
                    <li key={item} className="flex items-center gap-2.5">
                      <span className="w-4 h-4 rounded-full bg-yellow-100 flex items-center justify-center shrink-0">
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="#ca8a04" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link to="/signup" className="w-full text-center border border-gray-300 hover:border-gray-400 bg-white hover:bg-gray-50 text-gray-800 text-sm font-semibold py-3 rounded-xl transition-colors">
                  Get Started Free
                </Link>
              </div>

              {/* Pro Plan */}
              <div className="rounded-2xl p-8 flex flex-col relative" style={{ background: 'linear-gradient(145deg, #1d4ed8 0%, #2563eb 60%, #1e40af 100%)' }}>
                <span className="absolute -top-3 left-8 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-sm text-blue-900" style={{ backgroundColor: '#facc15' }}>Auto-renews</span>
                <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-6 bg-white/15 text-white w-fit">
                  Pro
                </span>
                <div className="flex items-baseline gap-1.5 mb-0.5">
                  <span className="text-5xl font-extrabold text-white">₹500</span>
                  <span className="text-blue-200 text-sm">/ month</span>
                </div>
                <p className="text-xs text-blue-300/70 mb-8">500–5,000 credits/mo, your choice</p>
                <ul className="space-y-3 text-sm text-white flex-1 mb-8">
                  {(content.proBullets ?? [
                    'Everything in Free',
                    'Unlimited Active List downloads',
                    'Credits delivered automatically, never run out mid-month',
                    'Change your tier or cancel any time',
                  ]).map(item => (
                    <li key={item} className="flex items-center gap-2.5">
                      <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      {item}
                    </li>
                  ))}
                </ul>
                <Link to="/signup" className="w-full text-center bg-white hover:bg-blue-50 text-blue-700 text-sm font-semibold py-3 rounded-xl transition-colors">
                  Get Started
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section aria-label="Frequently asked questions" className="py-24 px-6 bg-gray-50 border-y border-gray-100">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">FAQ</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Common questions</h2>
            </div>
            <div className="space-y-2">
              {faqEntries.map((faq) => (
                <FaqItem key={faq.q} q={faq.q} a={faq.a} />
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-28 px-6">
          <div className="max-w-xl mx-auto text-center">
            <div className="flex items-center justify-center gap-1.5 mb-8">
              <span className="h-1 w-8 rounded-full bg-blue-600" />
              <span className="h-1 w-4 rounded-full bg-orange-400" />
              <span className="h-1 w-2 rounded-full bg-yellow-400" />
            </div>
            <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
              {content.ctaHeadlineLine1}
              {content.ctaHeadlineLine2 && (
                <>
                  <br />
                  <span className="text-blue-600">{content.ctaHeadlineLine2}</span>
                </>
              )}
            </h2>
            <p className="text-gray-500 mb-10">
              {content.ctaSub}
            </p>
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-10 py-4 rounded-xl transition-all text-base"
            >
              Create Free Account <ArrowRight size={16} />
            </Link>
            <p className="text-xs text-gray-500 mt-5">No card needed.</p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
