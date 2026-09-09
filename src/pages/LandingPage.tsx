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
    tagline: 'Protect the client relationship.',
    bullets: [
      'Interviews every consultant on video before submission',
      'Finds fake resumes and proxies early',
      'Watches every group for available consultants',
      'Writes every resume request',
    ],
    accent: 'from-blue-600 to-indigo-500',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    buttonClass: 'bg-blue-600 hover:bg-blue-700',
    path: '/vendors',
    cta: 'Explore',
  },
  {
    persona: 'bench_sales',
    icon: UserRound,
    title: 'Bench Sales',
    tagline: 'Market the right consultants.',
    bullets: [
      'Shows how a consultant really answers questions',
      'Fills every submission from the resume',
      'Shows which skills vendors are posting now',
      'Submissions are always free',
    ],
    accent: 'from-orange-500 to-amber-400',
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-600',
    buttonClass: 'bg-orange-500 hover:bg-orange-600',
    path: '/bench-sales',
    cta: 'Explore',
  },
];

const FAQS = [
  {
    q: 'What is ProfilePush?',
    a: 'An AI copilot for US IT staffing. It watches every group for reqs and consultants. It writes the emails. It interviews every consultant on video.',
  },
  {
    q: 'Vendor or Bench Sales?',
    a: 'Vendor for reqs. Bench sales for consultants. One switch in the header. Same account either way.',
  },
  {
    q: 'How does video screening find fake resumes?',
    a: 'The interview is recorded. Each new question is based on the last answer. The copilot asks for a real number, a real tool, a real project. False claims fail fast.',
  },
  {
    q: 'What does it cost?',
    a: 'Free. 500 credits that never expire. A post costs 1 credit. An AI email costs 1 credit, refunded if it fails. Submitting is always free.',
  },
  {
    q: 'Is the data safe?',
    a: 'Yes. All data is encrypted. It is never sold. It is never shared between accounts.',
  },
  {
    q: 'Can a team share one account?',
    a: 'Yes. Unlimited members. No extra cost per person.',
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
        title="ProfilePush — AI Copilot for Vendors & Bench Sales in US IT Staffing"
        description="ProfilePush is the AI copilot for both sides of US IT staffing. Vendors get AI video screening that catches fake resumes and proxy interviews before submission. Bench Sales get a live list of vendors actively posting requirements, one-paste bulk posting, and free unlimited submissions."
        canonical="https://profilepush.ai/"
        jsonLd={LANDING_FAQ_JSONLD}
      />

      <MarketingNav />

      {/* ── HERO ── */}
      <section className="relative pt-24 md:pt-20 pb-16 md:pb-24 px-6 text-center overflow-hidden">
        <div className="relative max-w-3xl mx-auto">

          <h1 className="text-[clamp(2rem,6vw,3.75rem)] font-extrabold tracking-[-0.02em] leading-[1.08] mb-6">
            <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">An AI copilot for both sides of US IT staffing.</span>
          </h1>

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

        <div className="relative z-10 mt-8 md:mt-10 max-w-5xl mx-auto">
          <div className="grid grid-cols-2 gap-3 sm:gap-6 md:gap-8">
            {WORKFLOW_CARDS.map((card) => (
              <div key={card.persona} className="rounded-xl sm:rounded-2xl p-px gradient-border-frame shadow-xl shadow-gray-200/60">
                <div className="relative flex h-full flex-col rounded-xl sm:rounded-2xl bg-white p-3.5 sm:p-6 md:p-8 overflow-hidden text-left">
                  <span className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${card.accent}`} />
                  <span className={`inline-flex h-8 w-8 sm:h-11 sm:w-11 md:h-12 md:w-12 items-center justify-center rounded-lg sm:rounded-xl ${card.iconBg} ${card.iconColor} mb-2.5 sm:mb-4 md:mb-5`}>
                    <card.icon size={16} className="sm:hidden" />
                    <card.icon size={20} className="hidden sm:block" />
                  </span>
                  <h3 className="text-base sm:text-xl md:text-2xl font-extrabold text-gray-900 mb-1 sm:mb-1.5">{card.title}</h3>
                  <p className="text-[11px] sm:text-sm text-gray-500 mb-3 sm:mb-5 md:mb-6">{card.tagline}</p>
                  <ul className="space-y-1.5 sm:space-y-3 mb-4 sm:mb-6 md:mb-8 flex-1">
                    {card.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-1.5 sm:gap-2.5 text-[11px] sm:text-sm text-gray-700">
                        <span className={`mt-0.5 inline-flex h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0 items-center justify-center rounded-full ${card.iconBg}`}>
                          <Check size={9} className={card.iconColor} strokeWidth={3} />
                        </span>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                  <Link
                    to={card.path}
                    className={`w-full text-center text-white text-[11px] sm:text-sm font-semibold py-2 sm:py-3 rounded-lg sm:rounded-xl transition-colors flex items-center justify-center gap-1 sm:gap-1.5 ${card.buttonClass}`}
                  >
                    {card.cta} <ArrowRight size={12} className="hidden sm:inline" />
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
              Free. Then cheap.
            </h2>
            <p className="text-base text-gray-500 max-w-lg mx-auto leading-relaxed">
              500 credits that never expire. Browsing, submitting and editing are always free.
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
                  'All features included',
                  'Unlimited team members',
                  '50 Active List contacts per day',
                  '1 credit per post or AI email',
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
                  '500–5,000 credits every month',
                  'Credits arrive automatically',
                  'Cancel anytime',
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
            Let the AI copilot power your workflow.
          </h2>
          <p className="text-gray-500 mb-10">
            Stop scrolling groups. Start closing deals.
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

      {/* ── FOOTER ── */}
      </main>
      <SiteFooter />
    </div>
  );
}
