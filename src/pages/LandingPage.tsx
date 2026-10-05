import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Briefcase, Check, ChevronRight, Plus, Minus, ShieldCheck, UserRound,
  Radar, Sparkles, Send, KanbanSquare, Clock3, MapPin,
} from 'lucide-react';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import MarketingNav from '../components/MarketingNav';
import PricingCards from '../components/landing/PricingCards';
import RatingBlock from '../components/landing/RatingBlock';

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
  // Play Store screenshot for this persona. Full-bleed at the top of the card,
  // so the first thing a visitor sees is the product rather than a bullet list.
  image: string;
  imageAlt: string;
}

const WORKFLOW_CARDS: WorkflowCard[] = [
  {
    persona: 'vendor',
    icon: Briefcase,
    title: 'Vendor',
    tagline: 'Fill every requirement faster.',
    bullets: [
      'Matching consultants appear the day they are available',
      'One tap asks for resume, rate, visa and availability',
      'A live Tracker for every requirement',
      'Optional video screening when you want it',
    ],
    accent: 'from-blue-600 to-indigo-500',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    buttonClass: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50',
    path: '/vendors',
    cta: 'Explore',
    image: '/screens/vendors.jpg',
    imageAlt: 'ProfilePush for vendors: hotlist feed with consultant cards, rates, visa status and resume request',
  },
  {
    persona: 'bench_sales',
    icon: UserRound,
    title: 'Bench Sales',
    tagline: 'Market the right consultants.',
    bullets: [
      'New requirements matched to each consultant, live',
      'AI Submit writes the email and attaches the resume',
      'An alert the moment a strong match lands',
      'Submissions are always free',
    ],
    accent: 'from-orange-500 to-amber-400',
    iconBg: 'bg-orange-50',
    iconColor: 'text-orange-600',
    buttonClass: 'border-2 border-orange-500 text-orange-500 hover:bg-orange-50',
    path: '/bench-sales',
    cta: 'Explore',
    image: '/screens/bench-sales.jpg',
    imageAlt: 'ProfilePush for bench sales: live job feed with rates, locations and one-tap AI Submit',
  },
];

const FAQS = [
  {
    q: 'What is ProfilePush?',
    a: 'An AI copilot for US IT staffing. Paste a consultant or a requirement and it ranks the matches, writes the email, and keeps every new match in a live Tracker.',
  },
  {
    q: 'Vendor or Bench Sales?',
    a: 'Vendor for reqs. Bench sales for consultants. One switch in the header. Same account either way.',
  },
  {
    q: 'What is the Tracker?',
    a: 'A live board with a column for each consultant or requirement you post. New matches arrive there all day, newest first, and you get a notification when strong ones land. Reposts are merged, and anything you mark "Not a match" never comes back.',
  },
  {
    q: 'What does it cost?',
    a: 'Free. 100 credits that never expire, plus 10 more when you publish your first post and 10 when you send your first submission. A post costs 1 credit. An AI Submit draft costs 1 credit (AI Request drafts are free), and sending from your Gmail costs 1 credit, refunded if the send fails. Submitting is always free. Need more? Buy a credit pack from ₹249. There is no subscription.',
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
        description="ProfilePush is the AI copilot for both sides of US IT staffing. Paste a consultant or a requirement, get ranked matches, and the email writes itself. Every new match then lands in your live Tracker, all day. Submissions are always free."
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
          <p className="text-base md:text-lg text-gray-600 max-w-2xl mx-auto mb-8 leading-relaxed">
            Paste a consultant or a requirement. Get ranked matches. The email writes itself. Then every new match lands in your Tracker, live, all day.
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

        <div className="relative z-10 mt-8 md:mt-10 max-w-5xl mx-auto">
          <div className="grid grid-cols-2 gap-3 sm:gap-6 md:gap-8">
            {WORKFLOW_CARDS.map((card) => (
              <div key={card.persona} className="rounded-xl sm:rounded-2xl p-px gradient-border-frame shadow-xl shadow-gray-200/60">
                <div className="relative flex h-full flex-col rounded-xl sm:rounded-2xl bg-white overflow-hidden text-left">
                  <span className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${card.accent} z-10`} />
                  {/* Edge to edge: the card's padding starts below this, so the
                      screenshot spans the full width of the section column.
                      On a phone the whole 1080x1920 screenshot is shown, since
                      there is width to spare and the detail is legible. From
                      sm up it crops to the top half (9:8 of the full frame),
                      which keeps the header and first listings without making
                      a desktop card two screens tall. */}
                  <img
                    src={card.image}
                    alt={card.imageAlt}
                    width={820}
                    height={1458}
                    loading="lazy"
                    decoding="async"
                    className="w-full border-b border-gray-100 object-cover object-top aspect-auto sm:aspect-[9/8]"
                  />
                  <div className="flex flex-1 flex-col p-3.5 sm:p-6 md:p-8">
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
                    className={`w-full text-center bg-white text-[11px] sm:text-sm font-semibold py-2 sm:py-3 rounded-lg sm:rounded-xl transition-colors flex items-center justify-center gap-1 sm:gap-1.5 ${card.buttonClass}`}
                  >
                    {card.cta} <ArrowRight size={12} className="hidden sm:inline" />
                  </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── MARKET ── live counts, and the entry point to the public
           requirement pages. Numbers a visitor can check beat adjectives, and
           these links are what make those pages part of the site rather than
           a sitemap-only appendix. */}
      <section className="py-16 md:py-20 px-6 bg-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-10">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">The market, today</p>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">Around 900 new requirements land every weekday.</h2>
            <p className="text-gray-500 max-w-2xl mx-auto">New requirements and consultants every day, de-duplicated by recruiter and refreshed all day. Browse a slice of it without an account.</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
            {[
              { icon: Radar, stat: '~900', label: 'new requirements a weekday' },
              { icon: Clock3, stat: '30 days', label: 'rolling live window' },
              { icon: MapPin, stat: '50 states', label: 'plus remote' },
              { icon: Send, stat: 'Free', label: 'unlimited submissions' },
            ].map(item => (
              <div key={item.label} className="rounded-2xl border border-gray-200 p-5 text-center">
                <item.icon size={18} className="mx-auto mb-2 text-blue-600" />
                <p className="text-2xl font-extrabold text-gray-900">{item.stat}</p>
                <p className="text-xs text-gray-500 mt-1">{item.label}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap justify-center gap-2">
            {[
              ['java-developer', 'Java'],
              ['data-engineer', 'Data Engineer'],
              ['cloud-engineer', 'Cloud'],
              ['sap', 'SAP'],
              ['salesforce', 'Salesforce'],
              ['business-analyst', 'Business Analyst'],
              ['qa-automation', 'QA'],
              ['devops', 'DevOps'],
            ].map(([slug, label]) => (
              /* Plain anchors: these routes are served by a Pages Function, not
                 the SPA router, so a client-side navigation would 404. */
              <a
                key={slug}
                href={`/c2c-requirements/${slug}`}
                className="rounded-full border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-blue-300 hover:text-blue-700"
              >
                {label} C2C requirements
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-16 md:py-24 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">How it works</p>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Paste. Match. Send.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                icon: Sparkles,
                step: '01',
                title: 'Paste a consultant or a job',
                body: 'Paste the text you already have, or upload a resume. No forms, no field-by-field entry. It becomes your post at the same time.',
              },
              {
                icon: Radar,
                step: '02',
                title: 'Get matches ranked 1 to 10',
                body: 'Every open requirement from the last 30 days is scored against it, with a one-line reason and a flag when the visa, rate or location does not line up.',
              },
              {
                icon: Send,
                step: '03',
                title: 'The email writes itself',
                body: 'AI Submit or AI Request drafts the email from the match and sends it from your own Gmail, with the resume attached. Submissions are always free.',
              },
            ].map(item => (
              <div key={item.step} className="rounded-2xl border border-gray-200 bg-white p-6">
                <div className="flex items-center gap-3 mb-3">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <item.icon size={18} />
                  </span>
                  <span className="text-xs font-bold text-gray-400">{item.step}</span>
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-1.5">{item.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── TRACKER ── what brings people back: their matches keep coming. */}
      <section className="py-16 md:py-20 px-6 bg-gray-50 border-y border-gray-100">
        <div className="max-w-4xl mx-auto text-center">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-white border border-gray-200 text-blue-600 mb-4">
            <KanbanSquare size={22} />
          </span>
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Your matches keep coming. Live.</h2>
          <p className="text-gray-600 max-w-2xl mx-auto mb-8">
            Every consultant or requirement you post gets its own column in your Tracker. New matches land there all day, so you see them before everyone else does.
          </p>
          <div className="grid sm:grid-cols-3 gap-4 text-left">
            {[
              ['A column per post', 'Each consultant or requirement you post has its own live column of matches, newest first.'],
              ['Alerts that matter', 'A notification when strong new matches land, at most once an hour.'],
              ['Nothing twice', 'Reposts are merged, and anything you mark "Not a match" never comes back.'],
            ].map(([title, body]) => (
              <div key={title} className="rounded-xl bg-white border border-gray-200 p-4">
                <p className="text-sm font-bold text-gray-900 mb-1">{title}</p>
                <p className="text-xs text-gray-600 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <RatingBlock />

      {/* ── PRICING ── */}
      <section id="pricing" className="py-24 px-6 bg-white border-y border-gray-100">
        <div className="max-w-5xl mx-auto">

          <div className="text-center mb-14">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Pricing</p>
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              Free. Then cheap.
            </h2>
            <p className="text-base text-gray-500 max-w-lg mx-auto leading-relaxed">
              100 credits that never expire, plus 20 more as you get started. Browsing, submitting and editing are always free.
            </p>
          </div>

          <PricingCards />

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
            Stop chasing posts. Start closing deals.
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
