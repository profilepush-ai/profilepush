import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Building2, ChevronRight, Upload, ImagePlus, Plus, Minus, Target, Zap,
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
    subline: 'Pulse ranks every tech stack by live job count, consultant count, and average rate, so you know exactly where to focus before you spend a submission.',
    accent: 'from-indigo-50 to-white',
    badge: 'bg-indigo-100 text-indigo-700',
    badgeLabel: 'Pulse',
    topGlow: 'rgba(165,180,252,0.5)',
  },
  {
    key: 'pulse',
    slug: 'jobs',
    headline: 'Every requirement. The moment it posts.',
    subline: 'Jobs watches LinkedIn groups, Facebook groups, WhatsApp groups, Reddit groups, and job boards 24/7 for new requirements, lined up against your bench the moment they post. Submit drafts the outreach, attaches the resume, and opens a real conversation with the vendor.',
    accent: 'from-blue-100 to-white',
    badge: 'bg-blue-100 text-blue-700',
    badgeLabel: 'Jobs',
    topGlow: 'rgba(147,197,253,0.6)',
  },
  {
    key: 'hotlist',
    slug: 'hotlist',
    headline: 'Live in seconds. Every consultant.',
    subline: 'Hotlist surfaces available bench consultants posted by other recruiters the moment they\'re listed, lined up against your open requirements — so vendor teams can fill a role without cold-searching.',
    accent: 'from-amber-50 to-white',
    badge: 'bg-amber-100 text-amber-700',
    badgeLabel: 'Hotlist',
    topGlow: 'rgba(252,211,77,0.5)',
  },
  {
    key: 'posts',
    slug: 'posts',
    headline: 'Post it yourself. Get matched instantly.',
    subline: 'Can\'t find your role or consultant on the feeds? Post it directly — paste your job or hotlist listing and AI auto-fills every field. It shows up in the same Jobs and Hotlist feeds everyone else sees, and interested recruiters can chat with you about it right in-app.',
    accent: 'from-teal-50 to-white',
    badge: 'bg-teal-100 text-teal-700',
    badgeLabel: 'Posts',
    topGlow: 'rgba(94,234,212,0.5)',
  },
  {
    key: 'inbox',
    slug: 'inbox',
    headline: '1 submission. A real conversation.',
    subline: 'Every submission opens a live thread with the vendor — resume attached, reply and message right from your Inbox. Whether it\'s a vendor email thread or an in-app chat with another recruiter about a post, everything lands in one place, and you track opens so nothing goes cold.',
    accent: 'from-purple-50 to-white',
    badge: 'bg-purple-100 text-purple-700',
    badgeLabel: 'Inbox',
    topGlow: 'rgba(216,180,254,0.5)',
  },
  {
    key: 'tracker',
    slug: 'tracker',
    headline: '0 double-submittals. Ever.',
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
    a: 'ProfilePush is an AI copilot built for IT staffing — bench sales recruiters and vendor teams alike. It watches job posts and consultant listings across social platforms in real time, surfaces your best matches, drafts your outreach, and keeps your pipeline organized, so you can 10X your placements without 10x the headcount.',
  },
  {
    q: 'What is Pulse?',
    a: 'Pulse is your market-intelligence dashboard. It ranks every tech stack by live job count, consultant count, and average rate, so you know exactly which roles to chase before you spend a submission.',
  },
  {
    q: 'What are Jobs and Hotlist?',
    a: 'Jobs and Hotlist are live feeds pulled from LinkedIn groups, Facebook groups, WhatsApp groups, Reddit groups, and job boards. Jobs surfaces client requirements lined up against your bench; Hotlist surfaces available consultants lined up against your open requirements — so whichever side of the desk you’re on, you see your best matches first, the moment they post.',
  },
  {
    q: 'What is Posts?',
    a: 'Posts lets you list your own job or hotlist consultant directly on ProfilePush. Paste what you\'d normally post to a group and AI auto-fills the form for you. It joins the same Jobs and Hotlist feeds other recruiters browse, and anyone interested can chat with you about it in-app.',
  },
  {
    q: 'What is Inbox?',
    a: 'Inbox is AI-drafted outreach. One click writes a personalized email requesting job details or a resume, ready for you to review and send, then tracks opens and replies in a real conversation thread — alongside any in-app chats from your own Posts.',
  },
  {
    q: 'What is Tracker?',
    a: 'Tracker is your vendor and client CRM. Add contacts, log submissions with type badges (C2C, W2, Direct, Client, Vendor), filter by date range, and export everything to CSV. It keeps your pipeline organized so you never double-submit.',
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
                <p className="text-base text-gray-500 leading-relaxed max-w-2xl">{f.subline}</p>
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
                { n: '1', t: 'See what\'s hot', d: 'Pulse ranks every tech stack by live demand and rate, so you know where to focus before you spend a submission.', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
                { n: '2', t: 'Jobs & Hotlist go live', d: 'Jobs and Hotlist scan 500+ groups and job boards in real-time — new requirements and available consultants show up the moment they post.', dot: 'bg-indigo-500', num: 'text-indigo-500', ring: 'ring-indigo-100' },
                { n: '3', t: 'Submit with confidence', d: 'AI drafts the outreach, attaches the resume, and opens a real conversation in Inbox — no cold, generic pitch.', dot: 'bg-purple-500', num: 'text-purple-500', ring: 'ring-purple-100' },
                { n: '4', t: 'Close it in Tracker', d: 'Log every submission, avoid double-submittals, and export your pipeline anytime.', dot: 'bg-emerald-500', num: 'text-emerald-500', ring: 'ring-emerald-100' },
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

      {/* ── SUBMIT VS REVEAL ── */}
      <section id="submit" className="py-24 px-6 bg-gray-50 border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Why Submit, not Reveal</p>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
              Stop paying to peek. Start submitting to close.
            </h2>
            <p className="mt-4 max-w-2xl mx-auto text-gray-500 leading-relaxed">
              Revealing a contact just tells you who to email — you still have to write the pitch and hope it lands. Submitting tells the vendor you already have the right consultant: resume attached, AI-drafted outreach behind it, and a real conversation started before you've spent a single send.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 mb-16">
            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">The old way — Reveal</p>
              <ul className="space-y-3 text-sm text-gray-600">
                <li>Pay to unmask a name and email address</li>
                <li>You still write the pitch yourself, from scratch</li>
                <li>No signal on whether the fit is actually strong</li>
                <li>Vendor gets one more cold email to sift through</li>
              </ul>
            </div>
            <div className="rounded-2xl border-2 border-blue-600 bg-white p-6 shadow-lg shadow-blue-100">
              <p className="text-xs font-bold uppercase tracking-widest text-blue-600 mb-4">The ProfilePush way — Submit</p>
              <ul className="space-y-3 text-sm text-gray-700">
                <li>See it live the moment it's posted — not hours later</li>
                <li>AI drafts the outreach, resume attached automatically</li>
                <li>Opens a real conversation thread in your Inbox</li>
                <li>Vendor gets a pre-qualified candidate, not a cold ask</li>
              </ul>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-8">
            <div>
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center mb-3">
                <Target className="w-5 h-5 text-blue-700" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">For recruiters</h3>
              <p className="text-sm text-gray-500 leading-relaxed">Submit with a resume already attached and a real thread started — no more guessing which lead is worth chasing or writing the same pitch from scratch.</p>
            </div>
            <div>
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center mb-3">
                <Building2 className="w-5 h-5 text-amber-700" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">For vendors &amp; clients</h3>
              <p className="text-sm text-gray-500 leading-relaxed">Every submission lands pre-matched against your requirement with a resume in hand, not a generic cold pitch — less noise, faster decisions on both sides.</p>
            </div>
            <div>
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center mb-3">
                <BarChart3 className="w-5 h-5 text-emerald-700" />
              </div>
              <h3 className="font-semibold text-gray-900 mb-1">For agency owners</h3>
              <p className="text-sm text-gray-500 leading-relaxed">See every submission and every user on your team — one dashboard, real accountability for what you're paying to power.</p>
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
                <span className="text-5xl font-extrabold text-gray-900">500</span>
                <span className="text-gray-500 text-sm">credits</span>
              </div>
              <p className="text-sm font-semibold text-yellow-600 mb-1">One time · never expire</p>
              <p className="text-xs text-gray-500 mb-8">No credit card required</p>

              <ul className="space-y-3 text-sm text-gray-600 flex-1 mb-8">
                {[
                  'Pulse, Jobs, Hotlist, Posts, Inbox & Tracker included',
                  'Unlimited team members',
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
                <span className="text-4xl font-extrabold text-white">500&ndash;5,000</span>
              </div>
              <p className="text-sm font-semibold text-yellow-300 mb-1">credits every month, your choice — from ₹500/mo</p>
              <p className="text-xs text-blue-300/70 mb-8">Cancel any time — you keep access through what you've paid for</p>

              <ul className="space-y-3 text-sm text-white flex-1 mb-8">
                {[
                  'Everything in Free',
                  'Credits delivered automatically every month',
                  'Never run out mid-month',
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
