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
    key: 'resume-parsing',
    headline: 'Your hotlist, ready in 30 seconds.',
    subline: 'Paste Google Sheet or Excel rows of your hotlist to upload multiple candidates in one go.',
    accent: 'from-blue-100 to-white',
    badge: 'bg-blue-100 text-blue-700',
    badgeLabel: 'Bulk Import Profiles',
    topGlow: 'rgba(147,197,253,0.6)',
  },
  {
    key: 'omni-search',
    headline: '4 job boards. One search. Done.',
    subline: 'LinkedIn, Dice, Indeed, and Monster — all responding at once. Stop switching tabs and start closing roles.',
    accent: 'from-orange-50 to-white',
    badge: 'bg-orange-100 text-orange-700',
    badgeLabel: 'Omni-Board Search',
    topGlow: 'rgba(253,186,116,0.5)',
  },
  {
    key: 'bench',
    headline: 'Your entire bench, perfectly organized.',
    subline: 'Manage all your active consultants in one centralized hub. Stop digging through local desktop folders to find the right profile. Everything is parsed, structured, and instantly searchable.',
    accent: 'from-yellow-50 to-white',
    badge: 'bg-yellow-100 text-yellow-700',
    badgeLabel: 'Bench',
    topGlow: 'rgba(253,224,71,0.5)',
  },
  {
    key: 'hotlist-ai',
    headline: 'Paste a JD, Find your fit instantly.',
    subline: "Stop reading 3-page JDs at 2:00 AM. Paste any prime vendor requirement and let AI cross-reference your entire database to score and build a highly targeted shortlist in seconds.",
    accent: 'from-blue-50 to-white',
    badge: 'bg-blue-100 text-blue-700',
    badgeLabel: 'JD AI',
    topGlow: 'rgba(147,197,253,0.5)',
  },
  {
    key: 'submission-queue',
    headline: 'Stop saving jobs. Start submitting them.',
    subline: 'Your active execution hub. Queue up prime requirements for your candidate, verify AI match scores, and fire off tailored pitch emails. Hit submit and watch your daily targets clear out.',
    accent: 'from-yellow-50 to-white',
    badge: 'bg-yellow-100 text-yellow-700',
    badgeLabel: 'Submission Queue',
    topGlow: 'rgba(253,224,71,0.5)',
  },
  {
    key: 'resume-rewrite',
    headline: 'Tailored AI resumes, generated instantly.',
    subline: 'Stop wasting 20 minutes manually formatting every profile. Let AI automatically rewrite candidate resumes based on match gap suggestions so you can hit the vendor\'s inbox first.',
    accent: 'from-blue-50 to-white',
    badge: 'bg-blue-100 text-blue-700',
    badgeLabel: 'Resume Rewrite',
    topGlow: 'rgba(147,197,253,0.5)',
  },
  {
    key: 'tracker',
    headline: 'Throw away your messy Excel sheets.',
    subline: 'Every submission is logged automatically. The system actively builds a live CRM of your prime vendors, clients, and rates on autopilot, so you never risk a double-submittal again.',
    accent: 'from-emerald-50 to-white',
    badge: 'bg-emerald-100 text-emerald-700',
    badgeLabel: 'Tracker',
    topGlow: 'rgba(110,231,183,0.5)',
  },
  {
    key: 'desk',
    headline: 'Your daily metrics, analyzed automatically.',
    subline: 'AI analyzes your daily activity to reveal exactly which job boards are converting and where your candidates are stalled. No spreadsheets, just actionable insights.',
    accent: 'from-orange-50 to-white',
    badge: 'bg-orange-100 text-orange-700',
    badgeLabel: 'Desk',
    topGlow: 'rgba(253,186,116,0.5)',
  },
];

const FAQS = [
  {
    q: 'What is ProfilePush?',
    a: 'ProfilePush is an AI copilot purpose-built for Bench Sales recruiters and staffing firms. It automates the full sourcing-to-placement workflow — resume parsing, multi-board job search across LinkedIn, Dice, Indeed, Monster, and CareerBuilder, AI job match scoring, resume rewriting, and candidate outreach — all in one platform.',
  },
  {
    q: 'Who is ProfilePush designed for?',
    a: 'ProfilePush is built for Bench Sales recruiters, offshore recruiting pods, independent recruiters, and staffing desks that place candidates in contract (C2C, W2, 1099) and permanent technology roles across the United States.',
  },
  {
    q: 'Which job boards does ProfilePush search?',
    a: 'ProfilePush simultaneously searches LinkedIn, Dice, Indeed, Monster, and CareerBuilder — five of the most important platforms for Bench Sales placements — from a single query. No tab switching required.',
  },
  {
    q: 'How does AI job matching work in ProfilePush?',
    a: "ProfilePush AI scores each job against the candidate's profile, returning a percentage match with specific skill strengths, gap analysis, and keyword alignment recommendations. Recruiters know the quality of every submission before making a single call.",
  },
  {
    q: 'How much does ProfilePush cost?',
    a: 'Plans start at $29/month (Starter — up to 3 users), $59/month (Power — up to 5 users), and $99/month (Business — unlimited users). Every plan includes a matching AI credit wallet. A free account with $5 AI credits monthly is available to everyone — no credit card required.',
  },
  {
    q: 'Can ProfilePush automatically rewrite resumes?',
    a: 'Yes. The AI rewrites candidate resumes tailored to a specific job — aligning keywords, addressing skill gaps identified during match scoring, and producing a submission-ready document in seconds.',
  },
  {
    q: 'Is ProfilePush suitable for offshore Bench Sales teams?',
    a: 'Absolutely. ProfilePush is designed with offshore Bench Sales recruiting pods in mind. Every search, match, and submission is logged and timestamped. Team output is fully visible and measurable regardless of geography or time zone.',
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

  return (
    <div className="min-h-screen bg-white text-gray-900 overflow-x-hidden">
      <main>
      <SEO
        title="ProfilePush — AI Copilot for Bench Sales Recruiters"
        description="ProfilePush is the AI copilot built for Bench Sales recruiters. Parse resumes in 30 seconds, search LinkedIn, Dice, Indeed & Monster simultaneously, score AI job matches, and rewrite resumes — all in one platform."
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
            <Link to="/why-ai-copilot" className="hover:text-gray-900 transition-colors">Why AI Co-pilot</Link>
            <Link to="/how-it-works" className="hover:text-gray-900 transition-colors">How it Works</Link>
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
            <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">AI Copilot for Bench Sales Recruiters to Hit 10X Submissions</span>
          </h1>

          {/* Mobile-only hero video — between headline and subline */}
          <div className="block md:hidden mb-6 -mx-2">
            <div className="overflow-hidden border border-gray-200 shadow-2xl shadow-gray-300/40 ring-1 ring-gray-100/80 bg-white rounded-xl">
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                <iframe
                  src="https://www.loom.com/embed/691b8c9165be4319aed366641e54f159"
                  frameBorder="0"
                  allowFullScreen
                  className="absolute top-0 left-0 w-full h-full"
                />
              </div>
            </div>
          </div>

          <p className="text-base md:text-lg text-gray-500 max-w-2xl mx-auto mb-8 leading-relaxed">
            Stop spending 8 hours a day acting like a data-entry clerk fighting with MS Word and 15 open browser tabs. use AI copilot to hit your submission goals 10X faster.
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
      </section>

      {/* ── HERO VIDEO (desktop only) ── */}
      <div className="hidden md:block relative z-10 -mt-4 px-4 sm:px-8">
        <div className="max-w-6xl mx-auto">
          <div className="overflow-hidden border border-gray-200 shadow-2xl shadow-gray-300/40 ring-1 ring-gray-100/80 bg-white rounded-2xl">
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              <iframe
                src="https://www.loom.com/embed/691b8c9165be4319aed366641e54f159"
                frameBorder="0"
                allowFullScreen
                className="absolute top-0 left-0 w-full h-full"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── FEATURES HEADLINE ── */}

      {/* ── FEATURES ── */}
      <section id="features" className="py-10 px-4 md:py-16 md:px-6">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-widest text-blue-600 bg-blue-50 border border-blue-100 px-3 py-1 rounded-full mb-4">
              <Zap size={11} />
              All in one platform
            </span>
            <h2 className="text-4xl md:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-4">
              Powers of ProfilePush
            </h2>
            <p className="text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
              ProfilePush packs an entire recruiting workflow into a single platform — built specifically for the speed and precision of Bench Sales recruiting.
            </p>
          </div>

          {canEdit && (
            <div className="flex items-center justify-center gap-2 mb-10 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-sm text-blue-700">
              <Upload size={14} />
              <span>Hover any feature or hero area to upload a WebM video.</span>
            </div>
          )}

          <div className="divide-y divide-gray-100">
            {FEATURES.map((f) => {
              const imgUrl = screenshots[f.key] ?? null;

              return (
                <div key={f.key} className="flex flex-col gap-4 py-10 md:py-20">
                  {/* Row 1 — feature badge */}
                  <div>
                    <span className={`inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${f.badge}`}>
                      {f.badgeLabel}
                    </span>
                  </div>

                  {/* Row 2 — headline + subline */}
                  <div>
                    <h2 className="text-3xl md:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight mb-3 md:whitespace-nowrap overflow-hidden text-ellipsis">
                      {f.headline}
                    </h2>
                    <p className="text-gray-500 text-base md:text-lg leading-relaxed">
                      {f.subline}
                    </p>
                  </div>

                  {/* Row 3 — screenshot */}
                  <div className="w-full mt-2">
                    <GifSlot
                      featureKey={f.key}
                      imageUrl={imgUrl}
                      canEdit={canEdit}
                      onUploaded={handleUploaded}
                      accent={f.accent}
                      topGlow={f.topGlow}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-24 px-6 bg-white border-y border-gray-100">
        <div className="max-w-2xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">The workflow</p>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900">
              From raw resume to placed candidate
            </h2>
          </div>

          <div className="relative">
            {/* Vertical connector */}
            <div className="absolute left-6 top-6 bottom-6 w-px bg-gray-100" />

            <div className="space-y-0">
              {[
                { n: '1', t: 'Upload the resume', d: 'Drop a PDF — every skill, role, and date extracted instantly into a structured profile.', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
                { n: '2', t: 'Review the profile', d: 'Confirm the parsed details are accurate before moving to search.', dot: 'bg-orange-500', num: 'text-orange-500', ring: 'ring-orange-100' },
                { n: '3', t: 'Search 4 boards at once', d: 'One query hits LinkedIn, Dice, Indeed, and Monster simultaneously.', dot: 'bg-yellow-500', num: 'text-yellow-500', ring: 'ring-yellow-100' },
                { n: '4', t: 'Score the matches', d: 'AI ranks every job by fit — strengths, gaps, and a percentage match shown clearly.', dot: 'bg-blue-600', num: 'text-blue-600', ring: 'ring-blue-100' },
                { n: '5', t: 'Rewrite the resume', d: 'Tailored to the role in seconds, with keywords aligned to close the gap.', dot: 'bg-orange-500', num: 'text-orange-500', ring: 'ring-orange-100' },
                { n: '6', t: 'Send the outreach', d: 'A pre-drafted email with the rewritten resume attached. One click to send.', dot: 'bg-yellow-500', num: 'text-yellow-500', ring: 'ring-yellow-100' },
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
              Start free, upgrade when you're ready. Every plan unlocks all AI features.
            </p>
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
                  'All AI features unlocked',
                  'Up to 2 users',
                  'Up to 5 profiles',
                  '$5 AI credits reset each month',
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
                  'All AI features unlocked',
                  'Unlimited users',
                  'Unlimited profiles & storage',
                  'Multi-board job search',
                  'Vendor & client directory',
                  'Usage analytics & audit log',
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
            Ready to close
            <br />
            <span className="text-blue-600">your next role?</span>
          </h2>
          <p className="text-gray-500 mb-10">
            Stop juggling tabs. Start placing candidates.
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
