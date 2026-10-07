import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BarChart3, Bell, CheckCircle, FileUp, Globe, Inbox, Minus, Plus,
  ShieldCheck, Sparkles, UserRound, Briefcase, Zap,
} from 'lucide-react';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import MarketingNav from '../components/MarketingNav';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { WEBSITE_PLANS } from '../lib/website-plan';

// Website Modernization: an add-on for staffing firms. We rebuild a firm's
// existing website from its own content into a modern site built around the
// 2–3 enquiries that fit the firm (candidates, consultants, hiring clients,
// partners, training), send a private demo, and the owner claims it for one
// yearly plan (Website, or Live Website with a live jobs and bench portal)
// that also includes ProfilePush credits.
// The demo request form below writes to website_demo_requests and also goes
// to the CRM webhook the Contact page uses.

const CRM_WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/48XyGfN1WxneooOcHGHn/webhook-trigger/5acdf9f6-c8e2-44ea-91be-163a46cf83fd';
const CANONICAL = 'https://profilepush.ai/websites';
const TITLE = 'Website Modernization for IT Staffing Firms — ProfilePush';
const DESCRIPTION = `We rebuild your staffing website from your existing content into a modern site built to bring in the enquiries that grow your firm. Free demo. From ${WEBSITE_PLANS.website.priceLabel} a year, including hosting, an admin portal, email alerts and ProfilePush credits.`;

// Example sites on the page. Only firms that have agreed to be featured
// (the site's showcase flag in Admin > Website Demos).
const EXAMPLES = [
  {
    name: 'Cerf IT',
    what: 'IT, validation & quality staffing',
    goals: ['Candidates', 'Vendor partners'],
    url: 'https://site.profilepush.ai/cerfits-com/',
    image: '/screens/websites/cerf-it.jpg',
  },
];

const FEATURES = [
  { icon: UserRound, t: 'Built around your 2–3 goals', d: 'Candidates, consultant sign-ups, hiring clients, vendor partners or training enquiries: whichever bring your firm business.', tone: 'bg-yellow-100 text-yellow-700' },
  { icon: Briefcase, t: 'A form for each goal', d: 'Skills, work authorization, availability and résumé upload for people; roles, headcount and start dates for clients.', tone: 'bg-blue-100 text-blue-700' },
  { icon: Inbox, t: 'Admin portal', d: 'Every submission in one place, with résumé downloads, status tracking and CSV export.', tone: 'bg-purple-100 text-purple-700' },
  { icon: BarChart3, t: 'Website analytics', d: 'Visitors, top pages, traffic sources, devices, and how many visitors became enquiries.', tone: 'bg-emerald-100 text-emerald-700' },
  { icon: Bell, t: 'Email alerts & daily report', d: 'Choose who gets an email for each new enquiry, plus a daily analytics summary.', tone: 'bg-rose-100 text-rose-700' },
  { icon: Globe, t: 'Your domain, with HTTPS', d: 'Connect your own domain yourself, or we connect it for you. SSL is included.', tone: 'bg-orange-100 text-orange-700' },
];

const STEPS = [
  { n: '1', t: 'Send your current website', d: 'Share the link. No forms to fill, no content to write.' },
  { n: '2', t: 'We rebuild it', d: 'Your own services, story and contact details, in a modern design built to get enquiries.' },
  { n: '3', t: 'Review your private demo', d: 'You get a private demo link to see the new site before paying anything.' },
  { n: '4', t: 'Claim it and go live', d: `Pick Website (${WEBSITE_PLANS.website.priceLabel}) or Live Website (${WEBSITE_PLANS.live.priceLabel}) for the year, connect your domain and start receiving enquiries.` },
];

const FAQ = [
  { q: 'Is the demo really free?', a: 'Yes. We build the demo from your current website at no cost. You only pay if you want to claim it and go live.' },
  { q: `What does the Website plan include?`, a: `Everything, including GST, for ${WEBSITE_PLANS.website.priceLabel} a year: the rebuilt website, hosting with HTTPS, connecting your domain, the admin portal with submissions and analytics, email alerts, a daily analytics email, and ${WEBSITE_PLANS.website.creditsLabel} ProfilePush credits.` },
  { q: 'What does Live Website add?', a: `A live portal on your site that shows your current ProfilePush job posts and bench consultants, updated automatically as you post, so the site never goes stale. ${WEBSITE_PLANS.live.priceLabel} a year with ${WEBSITE_PLANS.live.creditsLabel} credits. You can upgrade from Website at any time.` },
  { q: 'Does the live portal show consultant names or rates?', a: 'No. It shows role, skills, experience, visa, location and availability only. Visitors who are interested send an enquiry through your site.' },
  { q: 'What can I do with the ProfilePush credits?', a: 'Use them across ProfilePush: Tracker matches, AI Match results, AI drafts, Gmail sends and video screenings. Credits never expire.' },
  { q: 'Do I need to write new content?', a: 'No. We use the content already on your website: your services, industries, about text and contact details. You can ask for changes before you go live.' },
  { q: 'Can I keep my domain?', a: 'Yes. Your domain stays yours. You point it to the new site with a DNS change, or we do it for you.' },
  { q: 'What happens if I do not renew?', a: 'The site goes back to demo mode and enquiries stop. You can export your submissions any time before that.' },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-5 py-4 text-left gap-4" aria-expanded={open}>
        <span className="font-semibold text-gray-900 text-sm leading-snug">{q}</span>
        {open ? <Minus size={14} className="shrink-0 text-gray-400" /> : <Plus size={14} className="shrink-0 text-gray-400" />}
      </button>
      {open && <div className="px-5 pb-4 text-sm text-gray-500 leading-relaxed border-t border-gray-50 pt-3">{a}</div>}
    </div>
  );
}

function Check({ children }: { children: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <CheckCircle size={16} className="mt-0.5 shrink-0 text-blue-600" />
      <span>{children}</span>
    </li>
  );
}

// Before/after visual: a dated site next to the rebuilt one. Pure markup, so
// it needs no screenshots and works in both widths.
function BeforeAfter() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-left">
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-gray-100 bg-gray-50">
          <span className="w-2.5 h-2.5 rounded-full bg-gray-300" /><span className="w-2.5 h-2.5 rounded-full bg-gray-300" /><span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
          <span className="ml-3 text-[11px] text-gray-400">Before</span>
        </div>
        <div className="p-5 space-y-3 bg-[#f4f4f0]">
          <div className="h-8 bg-[#2d4a7a] flex items-center px-3 gap-3">
            {['Home', 'About', 'Services', 'Careers', 'Contact'].map(l => <span key={l} className="text-[10px] text-white/80 underline">{l}</span>)}
          </div>
          <div className="h-24 bg-gradient-to-r from-gray-300 to-gray-200 flex items-center justify-center text-xs text-gray-500 italic">Welcome to our website</div>
          <div className="space-y-1.5">
            {[100, 92, 96, 70, 88, 60].map((w, i) => <div key={i} className="h-2 bg-gray-300 rounded" style={{ width: `${w}%` }} />)}
          </div>
          <p className="text-[11px] text-gray-500">Send your resume to info@… (no form, no tracking)</p>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-900 bg-[#07070c] shadow-xl overflow-hidden relative">
        <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-white/10">
          <span className="w-2.5 h-2.5 rounded-full bg-red-400" /><span className="w-2.5 h-2.5 rounded-full bg-yellow-400" /><span className="w-2.5 h-2.5 rounded-full bg-green-400" />
          <span className="ml-3 text-[11px] text-white/50">After</span>
        </div>
        <div className="p-5 relative">
          <div className="absolute -top-10 -right-10 w-48 h-48 rounded-full bg-violet-500/40 blur-3xl" />
          <div className="absolute -bottom-16 -left-10 w-48 h-48 rounded-full bg-lime-300/30 blur-3xl" />
          <div className="relative">
            <span className="inline-flex items-center gap-1.5 text-[10px] text-white/70 border border-white/15 rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-lime-300" /> Your firm · Since 2010
            </span>
            <p className="mt-3 text-2xl font-black leading-none tracking-tight text-white">
              Your headline, <span className="bg-gradient-to-r from-lime-300 via-cyan-300 to-violet-400 bg-clip-text text-transparent">rewritten.</span>
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-lime-300/40 bg-white/5 p-3">
                <p className="text-[9px] font-bold uppercase tracking-wider text-lime-300">Candidates</p>
                <p className="text-[11px] text-white mt-1 font-semibold">Find my next role →</p>
              </div>
              <div className="rounded-xl border border-violet-400/50 bg-white/5 p-3">
                <p className="text-[9px] font-bold uppercase tracking-wider text-violet-300">Employers</p>
                <p className="text-[11px] text-white mt-1 font-semibold">Hire talent →</p>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-white/60">
              <Bell size={11} className="text-lime-300" /> New enquiry · résumé attached
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DemoRequestForm() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: '', email: user?.email ?? '', phone: '', company: '', website_url: '', notes: '' });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const row = {
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      company: form.company.trim(),
      website_url: form.website_url.trim(),
      notes: form.notes.trim() || null,
      user_id: user?.id ?? null,
    };
    if (!row.name || !row.email || !row.company || !row.website_url) {
      setError('Please fill in your name, email, company and current website.');
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(row.email)) {
      setError('Please enter a valid email address.');
      return;
    }
    setSending(true);
    setError(null);
    // No .select(): the table has no read policy, so asking for the row back
    // would fail even though the insert succeeded.
    const { error: insertError } = await supabase.from('website_demo_requests' as never).insert(row as never);
    if (insertError) {
      setSending(false);
      setError('Something went wrong. Please try again, or email poorna@profilepush.ai.');
      return;
    }
    fetch(CRM_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'website demo request', ...row }),
    }).catch(() => {});
    setSending(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="text-center py-10">
        <div className="w-16 h-16 mx-auto rounded-full bg-blue-600 text-white flex items-center justify-center mb-5"><CheckCircle size={30} /></div>
        <h3 className="text-2xl font-extrabold text-gray-900 mb-2">Request received.</h3>
        <p className="text-gray-500 max-w-sm mx-auto">We'll rebuild {form.company || 'your site'} and email your private demo link to {form.email}.</p>
      </div>
    );
  }

  const input = 'w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-100 outline-none transition';
  return (
    <form onSubmit={handleSubmit} noValidate className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <input className={`${input} sm:col-span-2`} type="url" inputMode="url" placeholder="Your current website (e.g. yourcompany.com) *" value={form.website_url} onChange={set('website_url')} aria-label="Current website" required />
      <input className={input} placeholder="Your name *" value={form.name} onChange={set('name')} autoComplete="name" aria-label="Your name" required />
      <input className={input} placeholder="Company *" value={form.company} onChange={set('company')} autoComplete="organization" aria-label="Company" required />
      <input className={input} type="email" placeholder="Work email *" value={form.email} onChange={set('email')} autoComplete="email" aria-label="Work email" required />
      <input className={input} type="tel" placeholder="Phone" value={form.phone} onChange={set('phone')} autoComplete="tel" aria-label="Phone" />
      <textarea className={`${input} sm:col-span-2 min-h-[90px] resize-y`} placeholder="Anything we should know? (optional)" value={form.notes} onChange={set('notes')} aria-label="Notes" />
      {error && <p className="sm:col-span-2 text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={sending} className="sm:col-span-2 inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold px-8 py-4 rounded-xl transition-all text-base">
        {sending ? 'Sending…' : <>Get my free demo <ArrowRight size={16} /></>}
      </button>
      <p className="sm:col-span-2 text-xs text-gray-500 text-center">Free demo · No card needed · Pay only if you claim it</p>
    </form>
  );
}

export default function WebsitesLandingPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        '@id': `${CANONICAL}#service`,
        name: 'Website Modernization for IT Staffing Firms',
        description: DESCRIPTION,
        provider: { '@id': 'https://profilepush.ai/#organization' },
        offers: { '@type': 'AggregateOffer', lowPrice: WEBSITE_PLANS.website.priceInr, highPrice: WEBSITE_PLANS.live.priceInr, offerCount: 2, priceCurrency: 'INR', url: CANONICAL },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://profilepush.ai/' },
          { '@type': 'ListItem', position: 2, name: 'Websites', item: CANONICAL },
        ],
      },
      {
        '@type': 'FAQPage',
        mainEntity: FAQ.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      },
    ],
  };

  return (
    <div className="min-h-screen bg-white text-gray-900 overflow-x-hidden">
      <main>
        <SEO title={TITLE} description={DESCRIPTION} canonical={CANONICAL} jsonLd={jsonLd} />
        <MarketingNav />

        {/* ── HERO ── */}
        <section className="relative pt-28 md:pt-32 pb-16 px-6 text-center overflow-hidden">
          <div className="absolute inset-x-0 top-0 h-[520px] bg-gradient-to-b from-blue-50/70 to-white pointer-events-none" />
          <div className="relative max-w-3xl mx-auto">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1.5 rounded-full mb-6 bg-blue-100 text-blue-700">
              <Sparkles size={12} /> New · Website Modernization
            </span>
            <h1 className="text-[clamp(2.2rem,7vw,4.5rem)] font-extrabold tracking-[-0.02em] leading-[1.08] mb-5">
              <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">
                Your staffing website, rebuilt to bring in enquiries.
              </span>
            </h1>
            <p className="text-base md:text-lg text-gray-500 max-w-2xl mx-auto mb-8 leading-relaxed">
              We take the content already on your website and rebuild it as a modern site designed around the 2–3 enquiries that grow your firm, whether that's candidates, consultants, hiring clients or partners. See your demo free, and claim it only if you like it.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a href="#demo" className="bg-blue-600 hover:bg-blue-700 transition-all text-white font-semibold px-8 py-3.5 rounded-xl flex items-center gap-2 text-base w-full sm:w-auto justify-center">
                Get my free demo <ArrowRight size={16} />
              </a>
              <a href="#pricing" className="border border-gray-300 hover:border-gray-400 bg-white text-gray-800 font-semibold px-8 py-3.5 rounded-xl text-base w-full sm:w-auto text-center">
                See pricing
              </a>
            </div>
            <p className="mt-4 text-xs text-gray-500 flex items-center gap-2 flex-wrap justify-center">
              <span className="inline-flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />Free demo</span>
              <span className="text-gray-400">·</span>
              <span>From {WEBSITE_PLANS.website.priceLabel} / year, all inclusive</span>
              <span className="text-gray-400">·</span>
              <span>ProfilePush credits included</span>
            </p>
          </div>
          <div className="relative mt-12 max-w-5xl mx-auto">
            <BeforeAfter />
          </div>
        </section>

        {/* ── EXAMPLES ── */}
        <section id="examples" className="py-20 md:py-24 px-6 bg-white border-t border-gray-100 scroll-mt-16">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Examples</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">See a rebuilt website.</h2>
              <p className="text-base text-gray-500 max-w-xl mx-auto mt-3">Each site is designed around that firm's own goals and built only from its own content.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {EXAMPLES.map(ex => (
                <a key={ex.name} href={ex.url} target="_blank" rel="noreferrer" className="group block rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all">
                  <div className="flex items-center gap-1.5 px-4 py-2.5 border-b border-gray-100 bg-gray-50">
                    <span className="w-2.5 h-2.5 rounded-full bg-gray-300" /><span className="w-2.5 h-2.5 rounded-full bg-gray-300" /><span className="w-2.5 h-2.5 rounded-full bg-gray-300" />
                    <span className="ml-3 text-[11px] text-gray-400 truncate">{ex.url.replace('https://', '').replace(/\/$/, '')}</span>
                  </div>
                  <img src={ex.image} alt={`${ex.name} website`} loading="lazy" className="w-full aspect-[16/10] object-cover object-top" />
                  <div className="p-5 flex items-start justify-between gap-4">
                    <div>
                      <p className="font-bold text-gray-900">{ex.name}</p>
                      <p className="text-sm text-gray-500">{ex.what}</p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {ex.goals.map(g => <span key={g} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">{g}</span>)}
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 whitespace-nowrap group-hover:gap-2 transition-all">View site <ArrowRight size={14} /></span>
                  </div>
                </a>
              ))}
              <a href="#demo" className="flex flex-col items-center justify-center text-center rounded-2xl border-2 border-dashed border-gray-200 p-8 hover:border-blue-300 hover:bg-blue-50/40 transition-colors min-h-[260px]">
                <span className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center mb-4"><Sparkles size={20} /></span>
                <p className="font-bold text-gray-900">Your firm next</p>
                <p className="text-sm text-gray-500 mt-1 max-w-xs">Send us your current website and we'll build your free demo.</p>
              </a>
            </div>
          </div>
        </section>

        {/* ── PROBLEM ── */}
        <section className="py-16 md:py-20 px-6 bg-red-50/50 border-t border-gray-100">
          <div className="max-w-3xl mx-auto text-center">
            <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-4 bg-red-100 text-red-700">The problem</span>
            <h2 className="text-3xl md:text-4xl font-extrabold tracking-[-0.02em] leading-tight text-gray-900 mb-4">
              Your website gets visitors. It doesn't get enquiries.
            </h2>
            <p className="text-base text-gray-500 leading-relaxed">
              Most staffing websites list services and an email address. Candidates and vendors have no clear next step, so they leave, and you never see who visited.
            </p>
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section id="features" className="py-20 md:py-24 px-6 bg-gray-50 border-t border-gray-100">
          <div className="max-w-6xl mx-auto">
            <div className="text-center mb-14">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">What you get</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">A website with two goals, and the tools to follow up.</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {FEATURES.map(f => (
                <div key={f.t} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md hover:-translate-y-0.5 transition-all">
                  <span className={`inline-flex w-10 h-10 rounded-xl items-center justify-center ${f.tone}`}><f.icon size={18} /></span>
                  <h3 className="font-bold text-gray-900 text-lg mt-4 mb-1.5">{f.t}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{f.d}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 text-white p-6 md:p-8 flex flex-col md:flex-row md:items-center gap-5">
              <span className="w-12 h-12 shrink-0 rounded-xl bg-white/15 flex items-center justify-center"><Zap size={22} /></span>
              <div className="flex-1">
                <h3 className="font-bold text-xl mb-1">Connected to ProfilePush</h3>
                <p className="text-sm text-white/80 leading-relaxed">
                  Candidate enquiries can go straight to your bench, and vendor enquiries to your contacts, so the leads from your website land where your team already works.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ── */}
        <section id="how-it-works" className="py-24 px-6 bg-white border-y border-gray-100">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-16">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">How it works</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">From your old site to live, in four steps.</h2>
            </div>
            <div className="relative">
              <div className="absolute left-6 top-6 bottom-6 w-px bg-gray-100" />
              {STEPS.map(s => (
                <div key={s.n} className="relative flex gap-8 pb-10 last:pb-0">
                  <div className="relative z-10 w-12 h-12 shrink-0 rounded-full bg-white ring-4 ring-blue-100 border border-gray-100 shadow-sm flex items-center justify-center">
                    <span className="text-base font-black text-blue-600">{s.n}</span>
                  </div>
                  <div className="mt-[13px] min-w-0">
                    <div className="font-semibold text-gray-900 text-base mb-1">{s.t}</div>
                    <div className="text-sm text-gray-500 leading-relaxed">{s.d}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PRICING ── */}
        <section id="pricing" className="py-24 px-6 bg-white scroll-mt-16">
          <div className="max-w-5xl mx-auto">
            <div className="text-center mb-14">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Pricing</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">Two plans. Everything included.</h2>
              <p className="text-base text-gray-500 max-w-lg mx-auto leading-relaxed">The demo is free, and you pay only if you claim it. Pick a plan for the year, with ProfilePush credits included.</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
              {(['website', 'live'] as const).map(id => {
                const plan = WEBSITE_PLANS[id];
                const hot = id === 'live';
                return (
                  <div key={id} className={`bg-white rounded-2xl p-8 flex flex-col relative ${hot ? 'border-2 border-blue-600 shadow-xl shadow-blue-600/10' : 'border border-gray-200'}`}>
                    {hot && <span className="absolute -top-3 left-8 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-sm text-white bg-blue-600">Most value</span>}
                    <span className={`inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-4 w-fit ${hot ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>{plan.name}</span>
                    <div className="flex items-baseline gap-1.5 mb-0.5">
                      <span className="text-5xl font-extrabold text-gray-900">{plan.priceLabel}</span>
                      <span className="text-gray-500 text-sm">/ year</span>
                    </div>
                    <p className="text-xs text-gray-500 mb-4">All inclusive, GST included</p>
                    <p className="text-sm text-gray-600 mb-5 leading-relaxed">{plan.summary}</p>
                    <div className="rounded-xl bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 px-4 py-3 mb-6 flex items-center gap-3">
                      <Sparkles size={18} className="text-orange-500 shrink-0" />
                      <p className="text-sm text-gray-800"><b>{plan.creditsLabel} ProfilePush credits</b> <span className="text-gray-500">included, never expire</span></p>
                    </div>
                    <ul className="space-y-3 text-sm text-gray-600 flex-1 mb-8">
                      {plan.features.map(f => <Check key={f}>{f}</Check>)}
                    </ul>
                    <a href="#demo" className={`w-full text-center text-sm font-semibold py-3.5 rounded-xl transition-colors ${hot ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'border border-gray-300 hover:border-gray-400 text-gray-800'}`}>
                      Get my free demo
                    </a>
                  </div>
                );
              })}
            </div>
            <p className="text-center text-xs text-gray-500 mt-5 flex items-center justify-center gap-1.5">
              <ShieldCheck size={12} className="text-emerald-500" /> Already on ProfilePush? Your credits are added to your existing account.
            </p>
          </div>
        </section>

        {/* ── DEMO FORM ── */}
        <section id="demo" className="py-24 px-6 bg-gray-50 border-y border-gray-100 scroll-mt-16">
          <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Free demo</p>
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-[-0.02em] leading-[1.08] mb-5">
                <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">See your new website before you pay.</span>
              </h2>
              <p className="text-gray-500 leading-relaxed mb-6">Send us your current website. We'll rebuild it and email you a private demo link.</p>
              <ul className="space-y-3 text-sm text-gray-600">
                <li className="flex items-center gap-2.5"><Globe size={16} className="text-blue-600" /> Built from your existing content</li>
                <li className="flex items-center gap-2.5"><FileUp size={16} className="text-blue-600" /> Candidate and vendor forms ready to use</li>
                <li className="flex items-center gap-2.5"><ShieldCheck size={16} className="text-blue-600" /> Your demo stays private until you claim it</li>
              </ul>
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 shadow-xl p-6 md:p-8">
              <DemoRequestForm />
            </div>
          </div>
        </section>

        {/* ── FAQ ── */}
        <section aria-label="Frequently asked questions" className="py-24 px-6 bg-white">
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-12">
              <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">FAQ</p>
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Common questions</h2>
            </div>
            <div className="space-y-2">
              {FAQ.map(f => <FaqItem key={f.q} q={f.q} a={f.a} />)}
            </div>
            <p className="text-center text-sm text-gray-500 mt-8">
              Something else? <Link to="/contact" className="text-blue-600 font-semibold hover:underline">Contact us</Link>
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
