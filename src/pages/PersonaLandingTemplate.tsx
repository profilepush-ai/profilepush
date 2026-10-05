import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, Plus, Minus, ShieldCheck } from 'lucide-react';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import GifSlot from '../components/GifSlot';
import MarketingNav from '../components/MarketingNav';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PricingCards from '../components/landing/PricingCards';

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
  faq: FaqPair[];
  ctaHeadlineLine1: string;
  ctaHeadlineLine2?: string;
  ctaSub: string;
}

const PERSONA_CONTENT: Record<Persona, PersonaContent> = {
  vendor: {
    title: 'ProfilePush for Vendors — Matching Consultants, Live, for Every Requirement',
    description: 'ProfilePush is the AI copilot for vendor teams. Post a requirement and every matching bench consultant shows up in your Tracker, live. One tap sends an AI Request for the resume, rate, visa and availability, from your own Gmail.',
    canonical: 'https://profilepush.ai/vendors',
    heroHeadline: 'The AI Copilot that fills your requirements with the right consultants.',
    heroFeatureKey: 'hotlist',
    features: [
      {
        key: 'posts',
        slug: 'post-a-job',
        headline: 'The copilot fills the form.',
        subline: 'Paste the requirement as you have it. The copilot pulls out the skills, visa, rate and experience.',
        accent: 'from-teal-50 to-white',
        badge: 'bg-teal-100 text-teal-700',
        badgeLabel: 'Post a Job',
        topGlow: 'rgba(94,234,212,0.5)',
      },
      {
        key: 'hotlist',
        slug: 'hotlist',
        headline: 'The copilot finds available consultants.',
        subline: 'New bench consultants arrive every day. Each one is matched against your requirements the day they become available.',
        accent: 'from-amber-50 to-white',
        badge: 'bg-amber-100 text-amber-700',
        badgeLabel: 'Hotlist',
        topGlow: 'rgba(252,211,77,0.5)',
      },
      {
        key: 'inbox',
        slug: 'ai-outreach',
        headline: 'The copilot asks for the resume.',
        subline: 'One tap sends an AI Request to the bench recruiter: resume, rate, visa status and availability. The draft is free, and it sends from your own Gmail.',
        accent: 'from-purple-50 to-white',
        badge: 'bg-purple-100 text-purple-700',
        badgeLabel: 'AI Request',
        topGlow: 'rgba(216,180,254,0.5)',
      },
      {
        key: 'tracker',
        slug: 'tracker',
        headline: 'The copilot keeps a live board.',
        subline: 'Each requirement gets its own column in the Tracker. Matching consultants arrive all day, with an alert when strong ones land. Nothing is asked twice.',
        accent: 'from-emerald-50 to-white',
        badge: 'bg-emerald-100 text-emerald-700',
        badgeLabel: 'Tracker',
        topGlow: 'rgba(110,231,183,0.5)',
      },
      {
        key: 'screening',
        slug: 'screening',
        headline: 'Video screening, when you want it.',
        subline: 'Add an optional screening link to any request. The consultant records a short adaptive interview, and you get the recording, a score and a summary.',
        accent: 'from-rose-50 to-white',
        badge: 'bg-rose-100 text-rose-700',
        badgeLabel: 'Screening',
        topGlow: 'rgba(253,164,175,0.5)',
      },
    ],
    workflowEyebrow: 'The Workflow',
    workflowHeading: 'What the copilot does in the background.',
    howItWorks: [
      { n: '1', t: 'Finds', d: 'consultants matching each requirement, every day', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
      { n: '2', t: 'Fills', d: 'the requirement form, from pasted text', dot: 'bg-indigo-500', num: 'text-indigo-500', ring: 'ring-indigo-100' },
      { n: '3', t: 'Asks', d: 'for the resume, rate and availability, from your Gmail', dot: 'bg-purple-500', num: 'text-purple-500', ring: 'ring-purple-100' },
      { n: '4', t: 'Tracks', d: 'every match and request on a live board', dot: 'bg-emerald-500', num: 'text-emerald-500', ring: 'ring-emerald-100' },
    ],
    workflowClosing: 'The vendor: picks the consultants worth sending to the client.',
    faq: [
      { q: 'How do matching consultants reach me?', a: 'Post a requirement and the copilot matches it against bench consultants every day. Strong matches land in your Tracker and you get a notification.' },
      { q: 'What is an AI Request?', a: 'An email to the bench recruiter asking for the consultant\'s resume, rate, visa status and availability. The draft is free and it sends from your own Gmail.' },
      { q: 'Is video screening still available?', a: 'Yes, as an option. Tick "include a video screening link" on any request and the consultant can record a short adaptive interview with a score and a summary.' },
      { q: 'What costs credits?', a: 'A post costs 1 credit. AI Request drafts are free, and sending from your Gmail costs 1 credit, refunded if the send fails. A finished screening costs 10 credits. Editing is free. Credit packs start at ₹249.' },
      { q: 'Is the data safe?', a: 'Yes. All data is encrypted. It is never sold or shared. Emails send from a connected Gmail address.' },
    ],
    ctaHeadlineLine1: 'Fill the requirement faster.',
    ctaSub: 'Let the copilot bring you the consultants.',
  },
  bench_sales: {
    title: 'ProfilePush for Bench Sales — Live Requirements Matched to Every Consultant',
    description: 'ProfilePush is the AI copilot for bench sales recruiters. Add your consultants and every new requirement that fits shows up under each one, live. AI Submit writes the email, attaches the resume and sends it from your Gmail. Submissions are free.',
    canonical: 'https://profilepush.ai/bench-sales',
    heroHeadline: 'The AI Copilot that connects the bench to prime vendors.',
    heroFeatureKey: 'posts',
    features: [
      {
        key: 'pulse',
        slug: 'reqs',
        headline: 'The copilot matches every new requirement.',
        subline: 'New requirements arrive all day. Each one is matched against every consultant on the bench, so the right vendor shows up the day they post. Repeated posts are merged. Submit first, not fiftieth.',
        accent: 'from-blue-100 to-white',
        badge: 'bg-blue-100 text-blue-700',
        badgeLabel: 'Reqs',
        topGlow: 'rgba(147,197,253,0.6)',
      },
      {
        key: 'pulse',
        slug: 'submissions',
        headline: 'The copilot writes every submission.',
        subline: 'AI Submit drafts the email from the match and attaches the consultant\'s resume. One click sends it from your Gmail. Submissions never cost a credit, and there is no limit.',
        accent: 'from-blue-100 to-white',
        badge: 'bg-blue-100 text-blue-700',
        badgeLabel: 'Submissions',
        topGlow: 'rgba(147,197,253,0.6)',
      },
      {
        key: 'posts',
        slug: 'post-the-bench',
        headline: 'The copilot posts the whole bench in one paste.',
        subline: 'Paste the hotlist table exactly as it is. The copilot reads every consultant on it, and each one gets its own column of matches. Editing is always free.',
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
        headline: 'The copilot keeps a live board for each consultant.',
        subline: 'Each consultant has a column in the Tracker. New matches land there all day, with an alert when strong ones arrive. Attach the resume once and it goes with every submission.',
        accent: 'from-emerald-50 to-white',
        badge: 'bg-emerald-100 text-emerald-700',
        badgeLabel: 'Tracking',
        topGlow: 'rgba(110,231,183,0.5)',
      },
      {
        key: 'screening',
        slug: 'screening',
        headline: 'Optional video screening.',
        subline: 'Add a short screening link to a submission when it helps. The recruiter shares it with the consultant, and the vendor sees a real person, a score and a recording.',
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
      { n: '1', t: 'Matches', d: 'every new requirement to each consultant', dot: 'bg-sky-500', num: 'text-sky-500', ring: 'ring-sky-100' },
      { n: '2', t: 'Posts', d: 'the whole bench, from one pasted table', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
      { n: '3', t: 'Writes', d: 'every submission, with the resume attached', dot: 'bg-indigo-500', num: 'text-indigo-500', ring: 'ring-indigo-100' },
      { n: '4', t: 'Alerts', d: 'the moment a strong match lands', dot: 'bg-purple-500', num: 'text-purple-500', ring: 'ring-purple-100' },
      { n: '5', t: 'Tracks', d: 'every match and submission on a live board', dot: 'bg-emerald-500', num: 'text-emerald-500', ring: 'ring-emerald-100' },
    ],
    workflowClosing: 'The recruiter: picks the vendors and closes the deal.',
    pricingHeading: 'Free forever. Credits when you need more.',
    pricingBody: '100 credits that never expire, plus 20 more as you get started. Browsing, submitting and editing are always free.',
    freeBullets: [
      'All features included',
      'Unlimited team members',
      '3 open consultants or requirements on the Tracker',
      'Subscribe to 5 new people a day, up to 10',
      '1 credit per AI Match result, AI draft or Gmail send',
    ],
    faq: [
      { q: 'How does the copilot find prime vendors?', a: 'It matches every new requirement against your consultants. The vendors posting what your bench fits show up first, in each consultant\'s column.' },
      { q: 'Do I need to keep checking?', a: 'No. You get a notification when strong matches land, and an email if new matches are waiting and you have not been back.' },
      { q: 'Can the whole bench be posted at once?', a: 'Yes. Paste the hotlist table. The copilot reads every consultant and posts them all together.' },
      { q: 'What does submitting cost?', a: 'Nothing. Submissions are free and unlimited. Optional screening credits are charged to the vendor who owns the requirement.' },
      { q: 'Does the consultant need an account?', a: 'No. And the copilot never contacts them. The screening link goes to the recruiter only.' },
      { q: 'Can recruiters see which skills are in demand?', a: 'Yes. Every live req can be filtered by skill, rate, visa and location, with a live count on each.' },
      { q: 'Is the data safe?', a: 'Yes. All data is encrypted. It is never sold or shared. Vendors get no way to contact the consultants on a hotlist.' },
    ],
    ctaHeadlineLine1: 'Get the bench in front of prime vendors.',
    ctaSub: 'Stop pasting the same hotlist everywhere.',
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

  // Screenshots that ship with the build take priority over the storage
  // bucket. Writing to that bucket now requires the site owner's login (the
  // policies used to let any signed-in user overwrite it), so a repo-hosted
  // asset is the one path that needs no credentials, no upload step and no
  // round trip — it deploys with the code.
  const BUNDLED_SHOTS: Record<string, { desktop: string; mobile?: string }> = {
    hotlist: { desktop: '/screens/features/hotlist.jpg', mobile: '/screens/features/hotlist-mobile.jpg' },
    // Desktop only on purpose: the Active List table does not respond below
    // ~640px — it collapses into a column of vertical characters — so a phone
    // capture would advertise a layout bug. Without a mobile variant the slot
    // keeps its wide frame and shows this on every size.
    activelist: { desktop: '/screens/features/activelist.jpg' },
    inbox: { desktop: '/screens/features/inbox.jpg', mobile: '/screens/features/inbox-mobile.jpg' },
    pulse: { desktop: '/screens/features/pulse.jpg', mobile: '/screens/features/pulse-mobile.jpg' },
    posts: { desktop: '/screens/features/posts.jpg', mobile: '/screens/features/posts-mobile.jpg' },
    tracker: { desktop: '/screens/features/tracker.jpg', mobile: '/screens/features/tracker-mobile.jpg' },
  };

  const storageBaseUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/landing-assets/features`;
  const allKeys = Array.from(new Set([content.heroFeatureKey, ...content.features.map(f => f.key)]));
  // Only desktop keys get a .webm fallback. A `-mobile` key with no row in
  // landing_screenshots must stay undefined so GifSlot falls back to the
  // desktop asset, rather than pointing at a file that was never uploaded.
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
                <span>100 Free AI Credits</span>
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
              imageUrl={BUNDLED_SHOTS[heroFeature.key]?.desktop ?? screenshots[heroFeature.key] ?? null}
              mobileImageUrl={BUNDLED_SHOTS[heroFeature.key]?.mobile ?? screenshots[`${heroFeature.key}-mobile`] ?? null}
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
                  imageUrl={BUNDLED_SHOTS[f.key]?.desktop ?? screenshots[f.key] ?? null}
                  mobileImageUrl={BUNDLED_SHOTS[f.key]?.mobile ?? screenshots[`${f.key}-mobile`] ?? null}
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
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Pricing</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                {content.pricingHeading ?? 'Simple, transparent pricing.'}
              </h2>
              <p className="text-base text-gray-500 max-w-lg mx-auto leading-relaxed">
                {content.pricingBody ?? 'Start free with credits that never expire. Top up from ₹249 when you need more. No subscription.'}
              </p>
            </div>

            <PricingCards freeBullets={content.freeBullets} />
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
