import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ChevronRight, Upload, ImagePlus, Plus, Minus, ShieldCheck,
} from 'lucide-react';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// ── Feature definitions ────────────────────────────────────────────────────────
const FEATURES = [
  {
    key: 'marketpulse',
    slug: 'pulse',
    headline: '1 leaderboard. Every hot role.',
    subline: 'Ranks every tech stack by live demand and rate, so you stop guessing and chase the roles that actually convert.',
    accent: 'from-indigo-50 to-white',
    badge: 'bg-indigo-100 text-indigo-700',
    badgeLabel: 'Pulse',
    topGlow: 'rgba(165,180,252,0.5)',
  },
  {
    key: 'pulse',
    slug: 'jobs',
    headline: 'Every requirement. The moment it posts.',
    subline: 'AI watches LinkedIn, Facebook, WhatsApp, and Reddit groups plus job boards 24/7 — new requirements surface the moment they post, then AI Pitch drafts your outreach so you\'re never starting from a blank page.',
    accent: 'from-blue-100 to-white',
    badge: 'bg-blue-100 text-blue-700',
    badgeLabel: 'Jobs',
    topGlow: 'rgba(147,197,253,0.6)',
  },
  {
    key: 'hotlist',
    slug: 'hotlist',
    headline: 'Live in seconds. Every consultant.',
    subline: 'AI watches the same groups and boards 24/7 for new consultant listings — available candidates surface the moment they\'re posted, then AI Request drafts your resume ask so you spend time closing, not typing.',
    accent: 'from-amber-50 to-white',
    badge: 'bg-amber-100 text-amber-700',
    badgeLabel: 'Hotlist',
    topGlow: 'rgba(252,211,77,0.5)',
  },
  {
    key: 'posts',
    slug: 'posts',
    headline: 'Post it yourself. Get matched instantly.',
    subline: 'Paste your listing and AI fills the form instantly — it joins the same feeds everyone browses, so interested recruiters can reach you in-app within minutes.',
    accent: 'from-teal-50 to-white',
    badge: 'bg-teal-100 text-teal-700',
    badgeLabel: 'Posts',
    topGlow: 'rgba(94,234,212,0.5)',
  },
  {
    key: 'activelist',
    slug: 'active-list',
    headline: 'Every active vendor and recruiter. One list.',
    subline: 'A filterable contact list of everyone actively posting jobs or consultants — skip the manual scrolling, filter by exactly what you need, and export the emails in seconds.',
    accent: 'from-sky-50 to-white',
    badge: 'bg-sky-100 text-sky-700',
    badgeLabel: 'Active List',
    topGlow: 'rgba(125,211,252,0.5)',
  },
  {
    key: 'inbox',
    slug: 'inbox',
    headline: '1 submission. A real conversation.',
    subline: 'Every AI-drafted pitch and request opens into one real conversation here — no more digging through your email for who replied to what.',
    accent: 'from-purple-50 to-white',
    badge: 'bg-purple-100 text-purple-700',
    badgeLabel: 'Inbox',
    topGlow: 'rgba(216,180,254,0.5)',
  },
  {
    key: 'tracker',
    slug: 'tracker',
    headline: '0 double-submittals. Ever.',
    subline: 'Every vendor and client in one CRM — log submissions, filter by date, export to CSV, and never lose a placement to a duplicate submittal.',
    accent: 'from-emerald-50 to-white',
    badge: 'bg-emerald-100 text-emerald-700',
    badgeLabel: 'Tracker',
    topGlow: 'rgba(110,231,183,0.5)',
  },
];

const FAQS = [
  {
    q: 'What is ProfilePush?',
    a: 'ProfilePush is an AI copilot built for IT staffing — bench sales recruiters and vendor teams alike. It watches job posts and consultant listings across social platforms in real time, surfaces your best matches, drafts your outreach, and keeps your pipeline organized, so you can 10X your placements without 10x the headcount.',
  },
  {
    q: 'What is Pulse?',
    a: 'Pulse is your market-intelligence dashboard — it ranks every tech stack by live demand and rate, so you chase the roles that convert instead of guessing.',
  },
  {
    q: 'What are Jobs and Hotlist?',
    a: 'Jobs and Hotlist are live feeds — AI watches LinkedIn, Facebook, WhatsApp, and Reddit groups plus job boards 24/7. Jobs surfaces client requirements the moment they post; Hotlist surfaces available consultants the moment they\'re listed — so whichever side of the desk you\'re on, you see it before it\'s buried in a group feed.',
  },
  {
    q: 'What is AI Pitch / AI Request?',
    a: 'AI Pitch (on Jobs) and AI Request (on Hotlist) draft a personalized outreach email for you in seconds — requesting missing job details or a resume. You review the draft, then copy it or send it yourself today; sending it directly from your own inbox is launching soon.',
  },
  {
    q: 'What is Posts?',
    a: 'Posts lets you list your own job or consultant directly on ProfilePush — paste what you\'d normally post to a group, AI auto-fills the form, and it joins the same feeds everyone else browses so interested recruiters can chat with you in-app immediately.',
  },
  {
    q: 'What is Active List?',
    a: 'Active List is a consolidated, filterable contact list of every vendor and recruiter who\'s posted a job requirement or consultant listing recently — filter by role, skills, experience, work type, visa status, and rate, then download names and emails. Free accounts can download up to 50 contacts at a time, 500 total; Pro accounts have no cap.',
  },
  {
    q: 'What is Inbox?',
    a: 'Inbox is where every AI-drafted pitch or request becomes a real conversation — replies, opens, and any in-app chats from your own Posts, all in one thread, instead of scattered across email.',
  },
  {
    q: 'What is Tracker?',
    a: 'Tracker is your vendor and client CRM. Add contacts, log submissions with type badges (C2C, W2, Direct, Client, Vendor), filter by date range, and export everything to CSV. It keeps your pipeline organized so you never double-submit.',
  },
  {
    q: 'How does ProfilePush actually get me to 10X placements?',
    a: 'Every stage removes a step that used to cost you time: AI watches social channels and job boards 24/7 so you see a post the moment it\'s live instead of scrolling groups yourself; AI Pitch/Request hands you a drafted email instead of a blank page, with direct sending from your own inbox launching soon; Inbox keeps every reply in one thread instead of scattered across email; and Tracker stops you from double-submitting the same consultant. Less time per placement means more placements in the same day.',
  },
  {
    q: 'How much does ProfilePush cost?',
    a: 'ProfilePush is free to start — no credit card required. Every account gets 500 free AI credits, one time, that never expire. Generating an email draft, an AI chat draft, or a new post each cost 1 credit. Top up any time in 500-credit packs at a flat ₹1 per credit, or subscribe to Pro from ₹500/month to have credits delivered automatically every cycle.',
  },
];

const LANDING_FAQ_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: FAQS.map(f => ({
    '@type': 'Question',
    name: f.q,
    acceptedAnswer: { '@type': 'Answer', text: f.a },
  })),
};



// ── Video slot ──────────────────────────────────────────────────────────────────
function GifSlot({
  featureKey,
  imageUrl,
  canEdit,
  onUploaded,
  accent,
  topGlow,
}: {
  featureKey: string;
  imageUrl: string | null;
  canEdit: boolean;
  onUploaded: (key: string, url: string) => void;
  accent: string;
  topGlow: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const isVideo = !!imageUrl && /\.(webm|mp4|mov)(\?|$)/i.test(imageUrl);

  useEffect(() => {
    const vid = videoRef.current;
    if (vid && imageUrl) {
      vid.setAttribute('webkit-playsinline', '');
      vid.play().catch(() => {});
    }
  }, [imageUrl]);

  async function handleFile(file: File) {
    if (!['video/webm', 'video/mp4'].includes(file.type)) return;
    setUploading(true);
    try {
      const ext = file.type === 'video/mp4' ? 'mp4' : 'webm';
      const path = `features/${featureKey}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('landing-assets')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from('landing-assets').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      await supabase
        .from('landing_screenshots')
        .upsert({ feature_key: featureKey, image_url: publicUrl, updated_at: new Date().toISOString() }, { onConflict: 'feature_key' });

      onUploaded(featureKey, publicUrl);
    } catch (err) {
      console.error('Upload failed:', err);
    }
    setUploading(false);
  }

  return (
    <div className="relative w-full">
      <div className="relative w-full aspect-[1866/968] p-px overflow-hidden shadow-2xl shadow-gray-300/40 gradient-border-frame">
      <div
        className="relative w-full h-full overflow-hidden bg-white group"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Content area */}
      <div className={`absolute inset-0 bg-gradient-to-br ${accent}`}>
        {imageUrl ? (
          isVideo ? (
          <video
            ref={videoRef}
            src={imageUrl}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            disablePictureInPicture
            disableRemotePlayback
            className="w-full h-full object-contain"
          />
          ) : (
            <img
              src={imageUrl}
              alt="Feature preview"
              loading="lazy"
              className="w-full h-full object-contain"
            />
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 border border-gray-200 flex items-center justify-center">
              <ImagePlus size={24} className="text-gray-300" />
            </div>
            <p className="text-gray-300 text-xs font-medium">Video will appear here</p>
          </div>
        )}
      </div>

      {/* Upload overlay */}
      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".webm,.mp4,video/webm,video/mp4"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
          />
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={`absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/75 backdrop-blur-sm transition-opacity duration-200 cursor-pointer ${hovered ? 'opacity-100' : 'opacity-0'}`}
          >
            {uploading ? (
              <LogoSpinner size={32} />
            ) : (
              <Upload size={22} className="text-blue-600" />
            )}
            <span className="text-blue-700 text-xs font-semibold">
              {uploading ? 'Uploading…' : imageUrl ? 'Replace Video' : 'Upload Video'}
            </span>
          </button>
        </>
      )}
      </div>
      </div>
    </div>
  );
}

// ── FAQ accordion item ─────────────────────────────────────────────────────────
function FaqItem({ q, a }: { q: string; a: string }) {
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

// ── Landing Page ───────────────────────────────────────────────────────────────
export default function LandingPage() {
  const { user } = useAuth();
  const canEdit = user?.email === 'poornapotluri27@gmail.com';

  const storageBaseUrl = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/landing-assets/features`;
  const fallbackScreenshots = FEATURES.reduce<Record<string, string>>((acc, f) => {
    acc[f.key] = `${storageBaseUrl}/${f.key}.webm`;
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
  }, []);

  function handleUploaded(key: string, url: string) {
    setScreenshots(prev => ({ ...prev, [key]: url }));
  }

  const pulseFeature = FEATURES.find(f => f.key === 'pulse');
  const pulseImageUrl = screenshots.pulse ?? null;

  return (
    <div className="min-h-screen bg-white text-gray-900 overflow-x-hidden">
      <main>
      <SEO
        title="ProfilePush — AI Copilot Built to 10X Placements for IT Staffing Teams"
        description="ProfilePush is the AI copilot for bench sales recruiters and vendor teams. It watches 500+ LinkedIn, Facebook, WhatsApp, and Reddit groups plus job boards, surfaces your best matches, drafts your outreach, and keeps your pipeline organized — so you 10X your placements without 10x the headcount."
        canonical="https://profilepush.ai/"
        jsonLd={LANDING_FAQ_JSONLD}
      />

      {/* ── NAV ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div>
            <Logo size="md" />
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-500">
            <a href="#features" className="hover:text-gray-900 transition-colors">Features</a>
            <a href="#pricing" className="hover:text-gray-900 transition-colors">Pricing</a>
            <Link to="/it-staffing-vendor-list" className="hover:text-gray-900 transition-colors">Vendors List</Link>
            <Link to="/it-staffing-bench-sales-recruiters-list" className="hover:text-gray-900 transition-colors">Recruiters List</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/signin" className="hidden sm:block text-sm text-gray-500 hover:text-gray-900 transition-colors">
              Sign In
            </Link>
            <Link
              to="/signup"
              className="bg-blue-600 hover:bg-blue-700 transition-colors text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5"
            >
              Start Free <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-20 md:pt-28 pb-6 md:pb-12 px-6 text-center overflow-hidden">
        <div className="relative max-w-3xl mx-auto">

          <h1 className="text-[clamp(2.2rem,7vw,4.5rem)] font-extrabold tracking-[-0.02em] leading-[1.08] mb-5">
            <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">AI Copilot for US IT Staffing Teams to hit 10X placements.</span>
          </h1>

          <p className="text-base md:text-lg text-gray-500 max-w-2xl mx-auto mb-8 leading-relaxed">
            Built for both sides of the desk — whether you're filling your bench with requirements or filling a requirement with a consultant, one AI copilot runs the whole loop.
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

        {pulseFeature && (
          <div className="relative z-10 mt-8 max-w-6xl mx-auto text-left">
            <GifSlot
              featureKey={pulseFeature.key}
              imageUrl={pulseImageUrl}
              canEdit={canEdit}
              onUploaded={handleUploaded}
              accent={pulseFeature.accent}
              topGlow={pulseFeature.topGlow}
            />
          </div>
        )}
      </section>

      {/* ── FEATURES ── */}
      <div id="features">
        {FEATURES.map((f, idx) => (
          <section
            key={f.key}
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
              From market signal to placement
            </h2>
          </div>

          <div className="relative">
            {/* Vertical connector */}
            <div className="absolute left-6 top-6 bottom-6 w-px bg-gray-100" />

            <div className="space-y-0">
              {[
                { n: '1', t: 'See what\'s hot', d: 'Pulse shows you exactly where the demand is, so you stop guessing and start where it counts.', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
                { n: '2', t: 'Jobs & Hotlist go live', d: 'AI watches LinkedIn, Facebook, WhatsApp, Reddit groups, and job boards 24/7 — new requirements and available consultants surface the moment they post, preview any post before you act.', dot: 'bg-indigo-500', num: 'text-indigo-500', ring: 'ring-indigo-100' },
                { n: '3', t: 'AI drafts your outreach', d: 'AI Pitch or AI Request drafts the email for you — copy it, tweak it, or send it. Sending straight from your own inbox is launching soon.', dot: 'bg-purple-500', num: 'text-purple-500', ring: 'ring-purple-100' },
                { n: '4', t: 'Track it, close it', d: 'Every reply lands in Inbox as one real conversation; log it in Tracker so you never lose a placement to a duplicate submittal.', dot: 'bg-emerald-500', num: 'text-emerald-500', ring: 'ring-emerald-100' },
              ].map((step) => (
                <div key={step.n} className="relative flex gap-8 pb-10 last:pb-0">
                  {/* Circle */}
                  <div className={`relative z-10 w-12 h-12 shrink-0 rounded-full bg-white ring-4 ${step.ring} border border-gray-100 shadow-sm flex items-center justify-center`}>
                    <span className={`text-base font-black ${step.num}`}>{step.n}</span>
                  </div>
                  {/* Content */}
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

      {/* ── PRICING ── */}
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
            {FAQS.map((faq) => (
              <FaqItem key={faq.q} q={faq.q} a={faq.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-28 px-6">
        <div className="max-w-xl mx-auto text-center">
          {/* Decorative accent bar */}
          <div className="flex items-center justify-center gap-1.5 mb-8">
            <span className="h-1 w-8 rounded-full bg-blue-600" />
            <span className="h-1 w-4 rounded-full bg-orange-400" />
            <span className="h-1 w-2 rounded-full bg-yellow-400" />
          </div>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tight text-gray-900 mb-4">
            Ready to
            <br />
            <span className="text-blue-600">10X your placements?</span>
          </h2>
          <p className="text-gray-500 mb-10">
            Stop scrolling groups. Start closing.
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

      {/* ── FOOTER ── */}
      </main>
      <SiteFooter />
    </div>
  );
}
