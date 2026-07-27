import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check, ChevronRight, Zap, Search, Users, FileText,
  BarChart2, Brain, Globe, Shield, Star,
} from 'lucide-react';
import Logo from '../components/Logo';
import SEO from '../components/SEO';

const TIERS = [
  { amount: 25,  label: '$25', popular: false },
  { amount: 50,  label: '$50', popular: false },
  { amount: 100, label: '$100', popular: true },
  { amount: 200, label: '$200', popular: false },
  { amount: 300, label: '$300', popular: false },
  { amount: 500, label: '$500', popular: false },
];

const AI_FEATURES = [
  { icon: FileText, label: 'AI Resume Parsing',       desc: 'Extract structured data from any PDF resume automatically' },
  { icon: Brain,    label: 'AI Job Match Scoring',    desc: 'Rate candidate-to-job fit with % score and reasoning' },
  { icon: Zap,      label: 'AI Resume Rewriter',      desc: 'Tailor resumes to specific job descriptions with one click' },
  { icon: Zap,      label: 'AI Field Rewriter',       desc: 'Optimize individual resume sections with targeted AI edits' },
  { icon: Star,     label: 'AI Search Ideas',         desc: 'Generate smart keyword and boolean search strings instantly' },
];

const SEARCH_FEATURES = [
  { icon: Globe, label: 'LinkedIn Jobs Search',   desc: 'Search and scrape LinkedIn job postings' },
  { icon: Globe, label: 'Dice.com Search',        desc: 'Real-time Dice job board scraping' },
  { icon: Globe, label: 'Indeed Search',          desc: 'Indeed job listings with salary data' },
  { icon: Globe, label: 'Monster Search',         desc: 'Monster.com job search integration' },
  { icon: Globe, label: 'CareerBuilder Search',   desc: 'CareerBuilder listings search' },
];

const PLATFORM_FEATURES = [
  { icon: Users,     label: 'Unlimited Team Members',      desc: 'Add your entire team — credits are shared across all members' },
  { icon: FileText,  label: 'Unlimited Candidate Bench',   desc: 'Store and manage as many candidate profiles as you need' },
  { icon: BarChart2, label: 'Submissions Tracker',         desc: 'Track C2C, W2, and 1099 submissions end-to-end' },
  { icon: Shield,    label: 'Vendor & Client Database',    desc: 'Maintain your vendor and client relationships in one place' },
  { icon: Users,     label: 'Candidate Onboarding Portal', desc: 'Self-service profile submission via a shareable link' },
  { icon: BarChart2, label: 'Usage Analytics',             desc: 'Detailed credit usage breakdown per feature and team member' },
  { icon: Shield,    label: 'Role-based Access Control',   desc: 'Admin, member, and assigned-only data access levels' },
  { icon: Search,    label: 'Activity Audit Log',          desc: 'Complete history of all actions across your team' },
];

const FAQS = [
  {
    q: 'How do credits work?',
    a: 'Your monthly plan adds that dollar amount as credits to your AI wallet. Credits are consumed each time you use an AI feature — resume rewrites, job match scores, field rewrites, and job board searches. Unused credits carry over until your next renewal.',
  },
  {
    q: 'Is there a free account?',
    a: 'Yes — every account is free forever with $5 AI credits refreshed monthly. No credit card required. You get full access to every feature. Upgrade to a paid plan when you need more AI credits.',
  },
  {
    q: 'Can I upgrade or downgrade anytime?',
    a: 'Yes. Upgrades take effect immediately — you are charged a prorated amount for the remainder of the billing period and receive the extra credits right away. Downgrades are scheduled for your next renewal date; your current credits stay usable until then.',
  },
  {
    q: 'Do unused credits roll over?',
    a: 'Monthly subscription credits reset each cycle. Any credits you top up manually from the Billing page never expire.',
  },
  {
    q: 'Can I add more credits mid-month?',
    a: 'Yes. You can top up your AI wallet at any time from the Billing page in any amount. Top-up credits are permanent and never expire.',
  },
  {
    q: 'How many users can I add?',
    a: 'Unlimited. Every Pro Plan allows you to invite as many team members as you need. All members share the same credit pool.',
  },
  {
    q: 'What if I cancel?',
    a: 'You keep access until the end of your billing period. After that, your data is retained for 30 days before permanent deletion. See our Cancellation & Refund Policy for full details.',
  },
  {
    q: 'Are payments in INR?',
    a: 'Yes. All payments are processed in INR via Razorpay at a fixed rate of ₹100 per dollar.',
  },
];

export default function PricingPage() {
  const [selectedTier, setSelectedTier] = useState(100);
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <SEO
        title="Pricing — ProfilePush AI Copilot for Bench Sales Recruiters"
        description="ProfilePush Pro starts at $25/month. Pick the credit amount you need. All AI features, unlimited users, cancel anytime."
        canonical="https://profilepush.ai/pricing"
      />

      {/* Nav */}
      <header className="border-b border-white/10 bg-[#0a0a0a]/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/"><Logo size="sm" /></Link>
          <div className="flex items-center gap-4">
            <Link to="/signin" className="text-sm text-gray-400 hover:text-white transition-colors">Sign In</Link>
            <Link
              to="/signup"
              className="bg-white hover:bg-gray-100 text-gray-900 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              Start Free
            </Link>
          </div>
        </div>
      </header>

      <main>
        {/* ── Hero ── */}
        <section className="pt-20 pb-16 px-6 text-center">
          <div className="max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 mb-8 text-xs text-gray-400 font-medium">
              <Zap size={11} className="text-amber-400" />
              Start with $5 free — no credit card required
            </div>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight mb-5 leading-tight">
              Pay for what you use.
              <span className="block text-gray-500">Nothing more.</span>
            </h1>
            <p className="text-lg text-gray-400 leading-relaxed max-w-xl mx-auto">
              Pick your monthly credit budget. Every Pro Plan unlocks every feature — unlimited users, all five job boards, every AI tool.
            </p>
          </div>
        </section>

        {/* ── Plan cards ── */}
        <section className="pb-20 px-6">
          <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-6">

            {/* Free Account Card */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-8 flex flex-col">
              <div className="mb-6">
                <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-white/10 text-gray-400 mb-4">
                  Free Account
                </span>
                <div className="flex items-end gap-2 mb-1">
                  <span className="text-5xl font-extrabold text-white">$0</span>
                  <span className="text-gray-500 pb-1">/ forever</span>
                </div>
                <p className="text-sm text-gray-500">$5 in free credits to explore every feature</p>
              </div>

              <ul className="space-y-3 text-sm flex-1 mb-8">
                {[
                  'All AI features unlocked',
                  'All 5 job board searches',
                  'Unlimited candidate bench',
                  'Unlimited team members',
                  '$5 trial credits (one-time)',
                  'No credit card required',
                ].map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-gray-400">
                    <span className="w-4 h-4 rounded-full bg-white/10 flex items-center justify-center shrink-0">
                      <Check size={9} className="text-gray-300" />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                to="/signup"
                className="w-full text-center text-sm font-semibold py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white transition-colors"
              >
                Create Free Account
              </Link>
            </div>

            {/* Pro Plan Card */}
            <div className="bg-white rounded-3xl p-8 flex flex-col relative">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                <span className="bg-blue-600 text-white text-[10px] font-bold uppercase tracking-widest px-4 py-1.5 rounded-full shadow-lg shadow-blue-600/40">
                  Pro Plan
                </span>
              </div>

              <div className="mb-6 mt-2">
                <div className="flex items-end gap-2 mb-1">
                  <span className="text-5xl font-extrabold text-gray-900">${selectedTier}</span>
                  <span className="text-gray-400 pb-1">/ month</span>
                </div>
                <p className="text-sm text-blue-600 font-semibold mb-1">
                  {selectedTier} credits added to your wallet monthly
                </p>
                <p className="text-xs text-gray-400">Payments processed in INR via Razorpay</p>
              </div>

              {/* Tier selector */}
              <div className="mb-7">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Monthly credit budget</p>
                <div className="grid grid-cols-3 gap-2">
                  {TIERS.map(tier => (
                    <button
                      key={tier.amount}
                      onClick={() => setSelectedTier(tier.amount)}
                      className={`relative py-2.5 rounded-xl text-sm font-bold border transition-all ${
                        selectedTier === tier.amount
                          ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200'
                          : 'bg-white border-gray-200 text-gray-700 hover:border-blue-400 hover:text-blue-600'
                      }`}
                    >
                      {tier.popular && selectedTier !== tier.amount && (
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold bg-amber-400 text-white px-1.5 py-0.5 rounded-full">
                          Popular
                        </span>
                      )}
                      {tier.label}
                    </button>
                  ))}
                </div>
              </div>

              <ul className="space-y-3 text-sm flex-1 mb-8">
                {[
                  'All AI features unlocked',
                  'All 5 job board searches',
                  'Unlimited candidate bench',
                  'Unlimited team members',
                  'Upgrade or downgrade anytime',
                  'Priority email support',
                ].map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-gray-700">
                    <span className="w-4 h-4 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                      <Check size={9} className="text-blue-600" />
                    </span>
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                to="/signup"
                className="w-full text-center text-sm font-semibold py-3.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors shadow-lg shadow-blue-200 flex items-center justify-center gap-2"
              >
                Get Started <ChevronRight size={15} />
              </Link>
            </div>
          </div>
        </section>

        {/* ── Credit explainer ── */}
        <section className="py-16 px-6 border-t border-white/10">
          <div className="max-w-3xl mx-auto text-center mb-12">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">How Credits Work</p>
            <h2 className="text-3xl font-bold text-white mb-4">Pay for what you use.</h2>
            <p className="text-gray-400 leading-relaxed">
              Every plan comes with a credit balance that powers all AI features. Credits are deducted per operation — a $100/month plan covers roughly 25 resume rewrites, 100+ job match scores, or thousands of field edits.
            </p>
          </div>
          <div className="max-w-3xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { op: 'Resume Rewrite',   credits: '~2–8 credits' },
              { op: 'Job Match Score',  credits: '~0.2 credits' },
              { op: 'Field Rewrite',    credits: '~0.4 credits' },
              { op: 'Job Board Search', credits: '~0.08 credits' },
            ].map(row => (
              <div key={row.op} className="bg-white/5 border border-white/10 rounded-2xl p-4 text-center">
                <p className="text-xs font-semibold text-gray-400 mb-2">{row.op}</p>
                <p className="text-base font-bold text-white">{row.credits}</p>
                <p className="text-[10px] text-gray-500 mt-1">per operation</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Everything included ── */}
        <section className="py-20 px-6 border-t border-white/10">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Everything Included</p>
              <h2 className="text-3xl font-bold text-white">Every plan. Every feature.</h2>
              <p className="text-gray-400 mt-3 max-w-xl mx-auto">No feature gates. The only difference between tiers is how many credits you get each month.</p>
            </div>

            <div className="grid md:grid-cols-3 gap-10">
              <div>
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <Brain size={14} className="text-blue-400" />
                  </div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">AI Features</h3>
                </div>
                <ul className="space-y-4">
                  {AI_FEATURES.map(f => (
                    <li key={f.label}>
                      <p className="text-sm font-semibold text-gray-200">{f.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{f.desc}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                    <Search size={14} className="text-emerald-400" />
                  </div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Job Boards</h3>
                </div>
                <ul className="space-y-4">
                  {SEARCH_FEATURES.map(f => (
                    <li key={f.label}>
                      <p className="text-sm font-semibold text-gray-200">{f.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{f.desc}</p>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-7 h-7 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <Shield size={14} className="text-amber-400" />
                  </div>
                  <h3 className="text-xs font-bold text-white uppercase tracking-wider">Platform</h3>
                </div>
                <ul className="space-y-4">
                  {PLATFORM_FEATURES.map(f => (
                    <li key={f.label}>
                      <p className="text-sm font-semibold text-gray-200">{f.label}</p>
                      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">{f.desc}</p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section className="py-20 px-6 border-t border-white/10">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">FAQ</p>
              <h2 className="text-3xl font-bold text-white">Common questions</h2>
            </div>
            <div className="space-y-3">
              {FAQS.map((faq, i) => (
                <div key={faq.q} className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left"
                  >
                    <span className="text-sm font-semibold text-white">{faq.q}</span>
                    <ChevronRight
                      size={15}
                      className={`text-gray-500 shrink-0 transition-transform duration-200 ${openFaq === i ? 'rotate-90' : ''}`}
                    />
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-5 text-sm text-gray-400 leading-relaxed border-t border-white/10 pt-4">
                      {faq.a}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="py-20 px-6 text-center">
          <div className="max-w-lg mx-auto">
            <h2 className="text-3xl font-extrabold text-white mb-4">Start in seconds.</h2>
            <p className="text-gray-400 mb-8">$5 free credits. No credit card. Full access from day one.</p>
            <Link
              to="/signup"
              className="inline-flex items-center gap-2 bg-white hover:bg-gray-100 text-gray-900 font-bold px-8 py-4 rounded-2xl transition-colors shadow-2xl text-base"
            >
              Create Free Account <ChevronRight size={16} />
            </Link>
            <p className="text-xs text-gray-500 mt-4">
              Questions?{' '}
              <Link to="/contact" className="text-gray-300 hover:text-white transition-colors">Contact us</Link>
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 py-8 px-6 text-center text-xs text-gray-600">
        © {new Date().getFullYear()} ProfilePush ·{' '}
        <Link to="/cancellation-refund" className="hover:text-gray-400 transition-colors">Cancellation & Refund Policy</Link>
        {' '}·{' '}
        <Link to="/privacy" className="hover:text-gray-400 transition-colors">Privacy</Link>
      </footer>
    </div>
  );
}
