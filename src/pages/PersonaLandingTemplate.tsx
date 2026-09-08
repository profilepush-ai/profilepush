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

interface PersonaContent {
  title: string;
  description: string;
  canonical: string;
  heroHeadline: string;
  heroSub: string;
  heroFeatureKey: string;
  features: FeatureEntry[];
  howItWorks: HowItWorksStep[];
  faq: FaqPair[];
  ctaHeadlineLine1: string;
  ctaHeadlineLine2: string;
  ctaSub: string;
}

// Shared FAQ entries every persona page includes on top of its own — pricing
// and security apply identically regardless of persona.
const SHARED_FAQ: FaqPair[] = [
  {
    q: 'How much does ProfilePush cost?',
    a: 'ProfilePush is free to start — no credit card required. Every account gets 500 free AI credits, one time, that never expire. Generating an email draft, an AI chat draft, or a new post each cost 1 credit; a completed AI video screening costs 50 credits. Top up any time in 500-credit packs at a flat ₹1 per credit, or subscribe to Pro from ₹500/month to have credits delivered automatically every cycle.',
  },
  {
    q: 'Is my data safe?',
    a: 'Yes — infrastructure runs on SOC2 Type II certified providers, all data is encrypted with AES-256, and your data is never sold to third parties.',
  },
];

const PERSONA_CONTENT: Record<Persona, PersonaContent> = {
  vendor: {
    title: 'ProfilePush for Vendors — Fill Requirements Faster with an AI Copilot',
    description: 'ProfilePush is the AI copilot for Vendor teams sourcing C2C requirements. Browse a live Hotlist of consultants, get AI-drafted outreach, and let AI pre-screen every applicant before you open a resume.',
    canonical: 'https://profilepush.ai/vendors',
    heroHeadline: 'AI Copilot for Vendor Teams to hit 10X placements.',
    heroSub: 'One AI copilot finds consultants, drafts your outreach, and pre-screens every applicant — before you ever open a resume.',
    heroFeatureKey: 'hotlist',
    features: [
      {
        key: 'posts',
        slug: 'post-a-job',
        headline: 'Post it in seconds. AI fills the rest.',
        subline: 'Paste your requirement — AI extracts the title, skills, visa type, and rate automatically, then it joins the same feed every Bench Sales recruiter is already browsing.',
        accent: 'from-teal-50 to-white',
        badge: 'bg-teal-100 text-teal-700',
        badgeLabel: 'Post a Job',
        topGlow: 'rgba(94,234,212,0.5)',
      },
      {
        key: 'hotlist',
        slug: 'browse-hotlist',
        headline: 'Every available consultant. Live.',
        subline: 'AI watches LinkedIn, Facebook, WhatsApp, and Reddit groups 24/7 for new consultant listings — available candidates surface the moment they post, so you\'re never chasing a name everyone else already called.',
        accent: 'from-amber-50 to-white',
        badge: 'bg-amber-100 text-amber-700',
        badgeLabel: 'Hotlist',
        topGlow: 'rgba(252,211,77,0.5)',
      },
      {
        key: 'inbox',
        slug: 'ai-outreach',
        headline: '0 blank emails. Ever.',
        subline: 'One click drafts a personalized resume request and sends it from your own connected Gmail — every reply lands in Inbox as one real conversation, not scattered across your email.',
        accent: 'from-purple-50 to-white',
        badge: 'bg-purple-100 text-purple-700',
        badgeLabel: 'AI Outreach',
        topGlow: 'rgba(216,180,254,0.5)',
      },
      {
        key: 'screening',
        slug: 'pre-screened',
        headline: 'AI interviews every applicant. You just watch the highlights.',
        subline: 'The moment someone applies to your job, AI runs an adaptive video interview with them automatically — you get a scored summary, the full recording, and their resume side by side, so you qualify or pass in minutes instead of scheduling a call.',
        accent: 'from-rose-50 to-white',
        badge: 'bg-rose-100 text-rose-700',
        badgeLabel: 'Video Screening',
        topGlow: 'rgba(253,164,175,0.5)',
      },
      {
        key: 'tracker',
        slug: 'track-requests',
        headline: '0 lost requests. Ever.',
        subline: 'Every resume ask lives in one place — see what\'s Requested, what came back, and what failed, without digging through email.',
        accent: 'from-emerald-50 to-white',
        badge: 'bg-emerald-100 text-emerald-700',
        badgeLabel: 'Tracker',
        topGlow: 'rgba(110,231,183,0.5)',
      },
      {
        key: 'activelist',
        slug: 'active-list',
        headline: 'Every active recruiter. One list.',
        subline: 'A filterable directory of everyone actively posting consultants recently — filter by exactly what you need and export the emails in seconds.',
        accent: 'from-sky-50 to-white',
        badge: 'bg-sky-100 text-sky-700',
        badgeLabel: 'Active List',
        topGlow: 'rgba(125,211,252,0.5)',
      },
    ],
    howItWorks: [
      { n: '1', t: 'See who\'s on the bench', d: 'Hotlist shows you available consultants the moment they\'re listed — platform posts and scraped listings in one feed.', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
      { n: '2', t: 'Post your requirement', d: 'Paste the JD, AI fills the form, and it joins the same feed every recruiter already browses.', dot: 'bg-indigo-500', num: 'text-indigo-500', ring: 'ring-indigo-100' },
      { n: '3', t: 'AI drafts outreach & screens applicants', d: 'One click sends a personalized resume request; every applicant gets an automatic AI video interview and score.', dot: 'bg-purple-500', num: 'text-purple-500', ring: 'ring-purple-100' },
      { n: '4', t: 'Review your shortlist, close faster', d: 'Tracker keeps every ask organized so you spend your time closing, not chasing status.', dot: 'bg-emerald-500', num: 'text-emerald-500', ring: 'ring-emerald-100' },
    ],
    faq: [
      { q: 'Do I have to screen every candidate myself?', a: 'No — the moment someone applies to your job, AI automatically runs an adaptive video interview and hands you a 0-100 score plus a written summary alongside their resume, so you can qualify or pass in minutes instead of scheduling a call.' },
      { q: 'What does posting a job cost?', a: '1 credit per new job post, out of your 500 free credits — editing an existing post is free.' },
      { q: 'Can I request a resume from a consultant I found on LinkedIn, not just ProfilePush?', a: 'Yes — AI watches LinkedIn, Facebook, WhatsApp, and Reddit groups for consultant listings too. On any scraped Hotlist post, one click drafts and sends a personalized resume request.' },
    ],
    ctaHeadlineLine1: 'Ready to',
    ctaHeadlineLine2: 'fill your next requirement faster?',
    ctaSub: 'Stop scrolling groups. Start filling requirements.',
  },
  bench_sales: {
    title: 'ProfilePush for Bench Sales — Get Your Consultants Placed Faster',
    description: 'ProfilePush is the AI copilot for Bench Sales recruiters. Post your whole bench in one paste, submit to jobs with one click, and let AI run the screening call for you.',
    canonical: 'https://profilepush.ai/bench-sales',
    heroHeadline: 'AI Copilot for Bench Sales Recruiters to hit 10X placements.',
    heroSub: 'Post your whole bench in one paste, submit to jobs with one click, and let AI run the screening call for you.',
    heroFeatureKey: 'posts',
    features: [
      {
        key: 'posts',
        slug: 'post-your-bench',
        headline: 'Post your whole bench. One paste.',
        subline: 'Paste a table of consultants and AI detects every candidate automatically — review the batch once, then post them all with one click.',
        accent: 'from-teal-50 to-white',
        badge: 'bg-teal-100 text-teal-700',
        badgeLabel: 'Post',
        topGlow: 'rgba(94,234,212,0.5)',
      },
      {
        key: 'pulse',
        slug: 'browse-jobs',
        headline: 'Every requirement. The moment it posts.',
        subline: 'AI watches LinkedIn, Facebook, WhatsApp, and Reddit groups plus job boards 24/7 — new requirements surface the moment they\'re live, so you\'re first in, not fiftieth.',
        accent: 'from-blue-100 to-white',
        badge: 'bg-blue-100 text-blue-700',
        badgeLabel: 'Jobs',
        topGlow: 'rgba(147,197,253,0.6)',
      },
      {
        key: 'pulse',
        slug: 'ai-submit',
        headline: '0 retyping. Ever.',
        subline: 'Upload a resume and AI extracts the candidate\'s name, email, and phone automatically — one click submits, no retyping a single field.',
        accent: 'from-blue-100 to-white',
        badge: 'bg-blue-100 text-blue-700',
        badgeLabel: 'AI Submit',
        topGlow: 'rgba(147,197,253,0.6)',
      },
      {
        key: 'screening',
        slug: 'self-serve-screening',
        headline: 'The interview happens without you.',
        subline: 'Share one link — your candidate completes an adaptive AI video interview on their own time, no ProfilePush account, no call to schedule. You get the score and recording back automatically.',
        accent: 'from-rose-50 to-white',
        badge: 'bg-rose-100 text-rose-700',
        badgeLabel: 'Video Screening',
        topGlow: 'rgba(253,164,175,0.5)',
      },
      {
        key: 'hotlist',
        slug: 'inbound-requests',
        headline: '0 missed requests. Ever.',
        subline: 'When a vendor asks for a resume off your Hotlist post, it shows up in one screen — upload the file, add a note, done.',
        accent: 'from-amber-50 to-white',
        badge: 'bg-amber-100 text-amber-700',
        badgeLabel: 'Hotlist Requests',
        topGlow: 'rgba(252,211,77,0.5)',
      },
      {
        key: 'tracker',
        slug: 'track-submissions',
        headline: 'Every submission. One score. One place.',
        subline: 'Submissions shows the status and AI score for every candidate you\'ve sent, so you know exactly who to follow up with.',
        accent: 'from-emerald-50 to-white',
        badge: 'bg-emerald-100 text-emerald-700',
        badgeLabel: 'Submissions',
        topGlow: 'rgba(110,231,183,0.5)',
      },
    ],
    howItWorks: [
      { n: '1', t: 'See what\'s hot', d: 'Jobs shows you requirements the moment they post — platform listings and scraped requirements in one feed.', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
      { n: '2', t: 'Post your consultant(s)', d: 'Paste one or a whole table — AI fills the form and reviews the batch for you.', dot: 'bg-indigo-500', num: 'text-indigo-500', ring: 'ring-indigo-100' },
      { n: '3', t: 'AI submits & screens automatically', d: 'One click submits with an auto-parsed resume; the candidate completes the AI video screening on their own time.', dot: 'bg-purple-500', num: 'text-purple-500', ring: 'ring-purple-100' },
      { n: '4', t: 'Track responses, get placed', d: 'Submissions keeps status and AI score in one place, so you know exactly who to follow up with.', dot: 'bg-emerald-500', num: 'text-emerald-500', ring: 'ring-emerald-100' },
    ],
    faq: [
      { q: 'Can I post more than one consultant at a time?', a: 'Yes — paste a table of consultants and AI detects every candidate automatically. Review the batch once, then post them all with a single click.' },
      { q: 'Does the candidate need an account to complete screening?', a: 'No — share the screening link and they complete an adaptive AI video interview on their own time, no ProfilePush account required.' },
      { q: 'What happens when a vendor requests a resume off my Hotlist post?', a: 'It shows up in your Submissions view with a status of Awaiting Resume — upload the file and an optional note, and the vendor sees it immediately with a notification.' },
    ],
    ctaHeadlineLine1: 'Ready to',
    ctaHeadlineLine2: 'get your bench placed faster?',
    ctaSub: 'Stop retyping resumes. Start getting placed.',
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
  const faqEntries = [...content.faq, ...SHARED_FAQ];

  const faqJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqEntries.map(f => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
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
          jsonLd={faqJsonLd}
        />

        <MarketingNav activePersona={persona} />

        {/* ── HERO ── */}
        <section className="relative pt-20 md:pt-28 pb-6 md:pb-12 px-6 text-center overflow-hidden">
          <div className="relative max-w-3xl mx-auto">
            <h1 className="text-[clamp(2.2rem,7vw,4.5rem)] font-extrabold tracking-[-0.02em] leading-[1.08] mb-5">
              <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">{content.heroHeadline}</span>
            </h1>

            <p className="text-base md:text-lg text-gray-500 max-w-2xl mx-auto mb-8 leading-relaxed">
              {content.heroSub}
            </p>

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
              <div className="flex flex-wrap items-center justify-center gap-2">
                {['SOC2 Type II Infrastructure', 'AES-256 Encrypted', '100% Privacy-First — Your Data Never Sold'].map(badge => (
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
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">The workflow</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
                From live signal to placement
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
          </div>
        </section>

        {/* ── PRICING (shared, unchanged) ── */}
        <section id="pricing" className="py-24 px-6 bg-white border-y border-gray-100">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-14">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Pricing</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
                Simple, transparent pricing.
              </h2>
              <p className="text-base text-gray-500 max-w-lg mx-auto leading-relaxed">
                Start free with credits that never expire. Upgrade to Pro when you want them delivered automatically.
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
                  {[
                    'Pulse, Jobs, Hotlist, Posts, Active List, Inbox & Tracker included',
                    'Unlimited team members',
                    'Active List: 50 contacts/download, 500 lifetime',
                    '1 credit per email draft, AI chat draft, or new post',
                  ].map(item => (
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
                  {[
                    'Everything in Free',
                    'Unlimited Active List downloads',
                    'Credits delivered automatically, never run out mid-month',
                    'Change your tier or cancel any time',
                  ].map(item => (
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
              <br />
              <span className="text-blue-600">{content.ctaHeadlineLine2}</span>
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
            <p className="text-xs text-gray-500 mt-5">No credit card required.</p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
