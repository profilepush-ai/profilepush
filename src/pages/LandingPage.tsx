import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Briefcase, Check, ChevronRight, Plus, Minus, ShieldCheck, UserRound,
} from 'lucide-react';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import MarketingNav from '../components/MarketingNav';

interface WorkflowCard {
  persona: 'vendor' | 'bench_sales';
  icon: typeof Briefcase;
  title: string;
  tagline: string;
  bullets: string[];
  accent: string;
  iconBg: string;
  iconColor: string;
  buttonClass: string;
  path: string;
  cta: string;
}

const WORKFLOW_CARDS: WorkflowCard[] = [
  {
    persona: 'vendor',
    icon: Briefcase,
    title: 'Vendor',
    tagline: 'Post requirements, source consultants, close faster.',
    bullets: [
      'Post a requirement in seconds — AI fills the form',
      'Browse a live Hotlist of available consultants',
      'One-click AI-drafted resume requests',
      'Every applicant AI-screened before you open a resume',
    ],
    accent: 'from-blue-600 to-indigo-500',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    buttonClass: 'bg-blue-600 hover:bg-blue-700',
    path: '/vendors',
    cta: 'See the Vendor Workflow',
  },
  {
    persona: 'bench_sales',
    icon: UserRound,
    title: 'Bench Sales',
    tagline: 'Post your bench, submit to jobs, get placed faster.',
    bullets: [
      'Post your whole bench in one paste',
      'Browse a live feed of new job requirements',
      'One-click AI Submit with resume auto-parse',
      'Share a self-serve AI screening link — no call needed',
    ],
    accent: 'from-orange-500 to-amber-400',
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-600',
    buttonClass: 'bg-orange-500 hover:bg-orange-600',
    path: '/bench-sales',
    cta: 'See the Bench Sales Workflow',
  },
];

const FAQS = [
  {
    q: 'What does ProfilePush actually do?',
    a: 'ProfilePush is an AI copilot for IT staffing. It watches live job and consultant activity around the clock, drafts your outreach the moment something matches, runs automatic AI video screening on every applicant, and keeps every conversation and submission organized in one place — so you place faster without adding headcount.',
  },
  {
    q: 'Should I sign up as a Vendor or a Bench Sales recruiter?',
    a: 'Whichever describes your day-to-day: choose Vendor if you post open requirements and source consultants to fill them, or Bench Sales if you market consultants and submit them against open jobs. See exactly how each workflow works above, and switch your persona anytime from the app header.',
  },
  {
    q: 'How does ProfilePush actually get me to 10X placements?',
    a: 'Every stage removes a step that used to cost you time — AI surfaces a match the moment it\'s live instead of you scrolling groups, drafts your outreach instead of a blank page, screens every applicant automatically instead of a scheduled call, and keeps every reply and submission in one place instead of scattered across email. Less time per placement means more placements in the same day.',
  },
  {
    q: 'How much does ProfilePush cost?',
    a: 'Free to start, no credit card required — every account gets 500 AI credits, one time, that never expire. Posting, generating an AI draft, and each chat message cost 1 credit; a completed AI video screening costs 50 credits. Top up in 500-credit packs at ₹1/credit, or subscribe to Pro from ₹500/month for credits delivered automatically.',
  },
  {
    q: 'Is my data safe?',
    a: 'Yes — infrastructure runs on SOC2 Type II certified providers, everything is encrypted with AES-256, and your data is never sold to third parties.',
  },
  {
    q: 'Can my whole team use one account?',
    a: 'Yes — every plan includes unlimited team members at no extra cost, so your whole desk can share the same pipeline, Inbox, and Tracker.',
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
  return (
    <div className="min-h-screen bg-white text-gray-900 overflow-x-hidden">
      <main>
      <SEO
        title="ProfilePush — AI Copilot Built to 10X Placements for IT Staffing Teams"
        description="ProfilePush is the AI copilot for bench sales recruiters and vendor teams. It watches 500+ LinkedIn, Facebook, WhatsApp, and Reddit groups plus job boards, surfaces your best matches, drafts your outreach, and keeps your pipeline organized — so you 10X your placements without 10x the headcount."
        canonical="https://profilepush.ai/"
        jsonLd={LANDING_FAQ_JSONLD}
      />

      <MarketingNav />

      {/* ── HERO ── */}
      <section className="relative pt-20 md:pt-28 pb-16 md:pb-24 px-6 text-center overflow-hidden">
        <div className="relative max-w-3xl mx-auto">

          <h1 className="text-[clamp(2.2rem,7vw,4.5rem)] font-extrabold tracking-[-0.02em] leading-[1.08] mb-5">
            <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">AI Copilot for US IT Staffing Teams to hit 10X placements.</span>
          </h1>

          <p className="text-base md:text-lg text-gray-500 max-w-2xl mx-auto mb-8 leading-relaxed">
            One AI copilot that watches the market, drafts your outreach, and screens every candidate automatically — built for Vendors and Bench Sales recruiters alike.
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
      </section>

      {/* ── VENDOR VS BENCH SALES ── */}
      <section id="workflows" className="py-20 md:py-24 px-6 bg-gray-50 border-t border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Built for Both Sides of the Desk</p>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-[-0.02em] leading-tight mb-4">
              <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">Which side are you on?</span>
            </h2>
            <p className="text-base text-gray-500 max-w-xl mx-auto leading-relaxed">
              Same AI copilot, two different workflows — pick yours and see exactly how it works.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            {WORKFLOW_CARDS.map((card) => (
              <div key={card.persona} className="rounded-2xl p-px gradient-border-frame shadow-xl shadow-gray-200/60">
                <div className="relative flex h-full flex-col rounded-2xl bg-white p-8 overflow-hidden">
                  <span className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${card.accent}`} />
                  <span className={`inline-flex h-12 w-12 items-center justify-center rounded-xl ${card.iconBg} ${card.iconColor} mb-5`}>
                    <card.icon size={22} />
                  </span>
                  <h3 className="text-2xl font-extrabold text-gray-900 mb-1.5">{card.title}</h3>
                  <p className="text-sm text-gray-500 mb-6">{card.tagline}</p>
                  <ul className="space-y-3 mb-8 flex-1">
                    {card.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-2.5 text-sm text-gray-700">
                        <span className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${card.iconBg}`}>
                          <Check size={10} className={card.iconColor} strokeWidth={3} />
                        </span>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to={card.path}
                    className={`w-full text-center text-white text-sm font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-1.5 ${card.buttonClass}`}
                  >
                    {card.cta} <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            ))}
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
