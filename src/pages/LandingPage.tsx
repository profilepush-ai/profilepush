import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, ChevronRight, Upload, ImagePlus, Plus, Minus, Zap,
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
    key: 'pulse',
    headline: 'AI-matched jobs from social platforms.',
    subline: 'Pulse watches LinkedIn groups, Facebook groups, WhatsApp groups, Reddit groups, and job boards in real-time, matching jobs to your tech stacks with AI scores and pulling vendor emails.',
    accent: 'from-blue-100 to-white',
    badge: 'bg-blue-100 text-blue-700',
    badgeLabel: 'Pulse',
    topGlow: 'rgba(147,197,253,0.6)',
  },
  {
    key: 'tracker',
    headline: 'Throw away your messy Excel sheets.',
    subline: 'Manage every vendor and client contact in one place. Log submissions with type badges (C2C, W2, Direct), filter by date range, and export to CSV. Never risk a double-submittal again.',
    accent: 'from-emerald-50 to-white',
    badge: 'bg-emerald-100 text-emerald-700',
    badgeLabel: 'Tracker',
    topGlow: 'rgba(110,231,183,0.5)',
  },
];

const FAQS = [
  {
    q: 'What is ProfilePush?',
    a: 'ProfilePush is an AI-powered platform built for Bench Sales recruiters. It watches job posts from social media groups and job boards in real-time, pulls vendor emails, and gives you a built-in vendor CRM to track every contact, submission, and rate in one place.',
  },
  {
    q: 'What is Pulse?',
    a: 'Pulse is a real-time social job feed powered by AI. It watches LinkedIn groups, Facebook groups, WhatsApp groups, Reddit groups, and job boards, scores each job against tech stack categories, and lets you reveal poster contact info (email, phone) to reach out directly.',
  },
  {
    q: 'What is Tracker?',
    a: 'Tracker is your vendor and client CRM. Add contacts, log submissions with type badges (C2C, W2, Direct, Client, Vendor), filter by date range, and export everything to CSV. It keeps your pipeline organized so you never double-submit.',
  },
  {
    q: 'How much does ProfilePush cost?',
    a: 'ProfilePush is free to start with $5 in monthly AI credits — no credit card required. Free plan accounts are limited to 10 reveals every day. The Pro plan at ₹2,500/month includes $25 in AI credits, unlimited users, and Live Job Alerts.',
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
      <div
        className="relative w-full aspect-[1866/968] overflow-hidden border border-gray-200 shadow-2xl shadow-gray-300/40 ring-1 ring-gray-100/80 bg-white group"
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
        title="ProfilePush — AI Copilot for watching job posts from social media groups"
        description="Our AI watches LinkedIn groups, Facebook groups, WhatsApp groups, Reddit groups and job boards 24/7, pulling vendor emails along with jobs so Bench Sales teams can stop scrolling and submit faster."
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
          </div>
          <div className="flex items-center gap-3">
            <Link to="/signin" className="hidden sm:block text-sm text-gray-500 hover:text-gray-900 transition-colors">
              Sign In
            </Link>
            <Link
              to="/signup"
              className="bg-blue-600 hover:bg-blue-700 transition-colors text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-sm"
            >
              Start Free <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-20 md:pt-28 pb-6 md:pb-12 px-6 text-center overflow-hidden">
        {/* Background blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-blue-50 rounded-full blur-[80px] opacity-80" />
          <div className="absolute top-32 right-0 w-72 h-72 bg-orange-100 rounded-full blur-[60px] opacity-60" />
          <div className="absolute top-48 left-0 w-64 h-64 bg-yellow-100 rounded-full blur-[60px] opacity-60" />
        </div>

        <div className="relative max-w-3xl mx-auto">

          <h1 className="text-[clamp(2.2rem,7vw,4.5rem)] font-extrabold tracking-[-0.02em] leading-[1.08] mb-5">
            <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">AI Copilot for watching job posts from social media groups</span>
          </h1>

          <p className="text-base md:text-lg text-gray-500 max-w-2xl mx-auto mb-8 leading-relaxed">
            Our AI watches LinkedIn groups, Facebook groups, WhatsApp groups, Reddit groups  and job boards 24/7 - pulling vendor emails along with jobs so you don't have to scroll through thousands of posts manually.
          </p>

          <div className="flex flex-col items-center justify-center gap-4">
            <Link
              to="/signup"
              className="bg-blue-600 hover:bg-blue-700 transition-all text-white font-semibold px-8 py-3.5 rounded-xl flex items-center gap-2 text-base shadow-lg shadow-blue-200 w-full sm:w-auto justify-center"
            >
              Start Free <ChevronRight size={16} />
            </Link>
            <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap justify-center">
              <span className="inline-flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                Forever Free
              </span>
              <span className="text-gray-400">·</span>
              <span>Monthly $5 free AI Credits</span>
              <span className="text-gray-400">·</span>
              <span>No Credit Card Required</span>
            </p>
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

      {/* ── FEATURES HEADLINE ── */}

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-24 px-6 bg-white border-y border-gray-100">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">The workflow</p>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
              From social post to submission
            </h2>
          </div>

          <div className="relative">
            {/* Vertical connector */}
            <div className="absolute left-6 top-6 bottom-6 w-px bg-gray-100" />

            <div className="space-y-0">
              {[
                { n: '1', t: 'Browse the Pulse feed', d: 'AI scans LinkedIn, Reddit, and other social platforms — surfacing matched jobs with scores in real-time.', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
                { n: '2', t: 'Reveal contacts', d: 'Unlock poster emails and phone numbers to reach out directly from the feed.', dot: 'bg-orange-500', num: 'text-orange-500', ring: 'ring-orange-100' },
                { n: '3', t: 'Track in Tracker', d: 'Log vendor contacts, submissions, and rates. Filter by date, export to CSV, and never double-submit.', dot: 'bg-yellow-500', num: 'text-yellow-500', ring: 'ring-yellow-100' },
              ].map((step, i, arr) => (
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
              Start free, upgrade when you're ready. Every plan unlocks all features.
            </p>

            {/* Free plan limit */}
            <div className="flex items-center justify-center gap-6 mt-4 text-sm text-gray-500">
              <span>Free plan: limited to 10 reveals every day</span>
            </div>
          </div>

          {/* 2-column plan cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

            {/* Free Plan */}
            <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col shadow-sm">
              <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-6 bg-yellow-100 text-yellow-700 w-fit">
                Free Plan
              </span>

              {/* INR price */}
              <div className="flex items-baseline gap-1.5 mb-0.5">
                <span className="text-5xl font-extrabold text-gray-900">₹0</span>
                <span className="text-gray-500 text-sm">/ month</span>
              </div>
              {/* Dollar credit sub-heading */}
              <p className="text-sm font-semibold text-yellow-600 mb-1">$5 in AI credits · refreshes monthly</p>
              <p className="text-xs text-gray-500 mb-8">No credit card required</p>

              <ul className="space-y-3 text-sm text-gray-600 flex-1 mb-8">
                {[
                  'All features unlocked',
                  'Up to 2 users',
                  '$5 AI credits reset each month',
                  'Limited to 10 reveals every day',
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
            <div className="rounded-2xl p-8 flex flex-col shadow-xl shadow-blue-200/50 relative" style={{ background: 'linear-gradient(145deg, #1d4ed8 0%, #2563eb 60%, #1e40af 100%)' }}>
              <span className="absolute -top-3 left-8 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-sm text-blue-900" style={{ backgroundColor: '#facc15' }}>Most Popular</span>
              <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-6 bg-white/15 text-white w-fit">
                Pro Plan
              </span>

              {/* INR price */}
              <div className="flex items-baseline gap-1.5 mb-0.5">
                <span className="text-5xl font-extrabold text-white">₹2,500</span>
                <span className="text-blue-200 text-sm">/ month</span>
              </div>
              {/* Dollar credit sub-heading */}
              <p className="text-sm font-semibold text-yellow-300 mb-1">$25 in AI credits · scale up anytime</p>
              <p className="text-xs text-blue-300/70 mb-8">Starting plan · tiers up to $500/mo</p>

              <ul className="space-y-3 text-sm text-white flex-1 mb-8">
                {[
                  'All features unlocked',
                  'Unlimited users',
                  'Full Tracker with CSV export',
                  'Live Job Alerts',
                ].map(item => (
                  <li key={item} className="flex items-center gap-2.5">
                    <span className="w-4 h-4 rounded-full bg-white/20 flex items-center justify-center shrink-0">
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>

              <Link to="/signup" className="w-full text-center bg-white hover:bg-blue-50 text-blue-700 text-sm font-semibold py-3 rounded-xl transition-colors shadow-md">
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
            Ready to find
            <br />
            <span className="text-blue-600">your next match?</span>
          </h2>
          <p className="text-gray-500 mb-10">
            Stop scrolling job boards. Start closing roles.
          </p>
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-10 py-4 rounded-xl transition-all shadow-lg shadow-blue-200 text-base"
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
