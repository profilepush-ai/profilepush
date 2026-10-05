import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Bell, CheckCircle, Globe, Inbox, Sparkles } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import { LIVE_UPGRADE, WEBSITE_PLANS, type WebsitePlanTier } from '../lib/website-plan';
import WebsiteSubmissions from '../components/website/WebsiteSubmissions';
import WebsiteAnalytics from '../components/website/WebsiteAnalytics';
import WebsiteDomain from '../components/website/WebsiteDomain';
import WebsiteNotifications from '../components/website/WebsiteNotifications';
import {
  fetchMyWebsitePlan, fetchMyWebsites, startWebsiteCheckout,
  type MyWebsite, type WebsiteCheckoutResult, type WebsitePlanStatus,
} from '../lib/website-checkout';

// The account's Website Modernization plan (status, and the ₹36,999 yearly
// checkout, which also adds 5,000 credits) and, for each claimed website,
// tabs for its enquiries, analytics, domain and notification settings.

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const TABS = [
  { id: 'enquiries', label: 'Enquiries', icon: Inbox },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'domain', label: 'Domain', icon: Globe },
  { id: 'notifications', label: 'Notifications', icon: Bell },
] as const;

function SiteManager({ site, onChanged }: { site: MyWebsite; onChanged: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('enquiries');
  return (
    <section className="space-y-3">
      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label={`${site.name} website`}>
        {TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[13px] font-semibold whitespace-nowrap ${tab === t.id ? 'bg-white border border-gray-200 text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>
      {tab === 'enquiries' && <WebsiteSubmissions site={site} />}
      {tab === 'analytics' && <WebsiteAnalytics websiteId={site.id} />}
      {tab === 'domain' && <WebsiteDomain site={site} onChanged={onChanged} />}
      {tab === 'notifications' && <WebsiteNotifications key={site.id} site={site} onSaved={onChanged} />}
    </section>
  );
}

export default function WebsitePage() {
  const { user, refreshAccount } = useAuth();
  const [plan, setPlan] = useState<WebsitePlanStatus | null>(null);
  const [sites, setSites] = useState<MyWebsite[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buying, setBuying] = useState<WebsitePlanTier | 'live_upgrade' | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [result, setResult] = useState<WebsiteCheckoutResult | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, w] = await Promise.all([fetchMyWebsitePlan(), fetchMyWebsites()]);
      setPlan(p);
      setSites(w);
      setLoadError(null);
    } catch {
      setLoadError('Could not load your website plan. Please refresh.');
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function buy(plan: WebsitePlanTier | 'live_upgrade') {
    setBuying(plan);
    setBuyError(null);
    try {
      const res = await startWebsiteCheckout({ name: user?.user_metadata?.full_name ?? '', email: user?.email ?? '' }, plan);
      if (res) {
        setResult(res);
        await Promise.all([load(), refreshAccount()]);
      }
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : 'Failed to start checkout');
    }
    setBuying(null);
  }

  const current = plan?.active ? (plan.plan ?? 'live') : null;

  return (
    <div className="min-h-[100dvh] flex flex-col bg-gray-50 pb-[calc(4.25rem+env(safe-area-inset-bottom))] sm:pb-0">
      <AppNav />

      <div className="px-3 sm:px-6 py-3 border-b border-gray-200 bg-white">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center">
            <Globe size={15} className="text-blue-600" />
          </div>
          <h1 className="text-[15px] font-bold text-gray-900">Website</h1>
        </div>
      </div>

      <main className="flex-1 px-3 sm:px-6 py-6">
        <div className="max-w-4xl mx-auto space-y-4">
          {!plan && !loadError && <div className="py-16 flex justify-center"><LogoSpinner /></div>}
          {loadError && <p className="text-sm text-red-600">{loadError}</p>}

          {result && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 flex gap-3">
              <CheckCircle size={20} className="text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-900">
                <p className="font-bold">Payment received{result.paymentId ? ` (${result.paymentId})` : ''}.</p>
                {result.confirmed ? (
                  <p>
                    Your plan is active{result.planExpiresAt ? ` until ${fmtDate(result.planExpiresAt)}` : ''} and your credits
                    were added{result.balance !== null ? `. Balance: ${result.balance.toLocaleString('en-IN')} credits` : ''}.
                  </p>
                ) : (
                  <p>We're confirming it with Razorpay. Your plan and credits will appear here within a few minutes.</p>
                )}
              </div>
            </div>
          )}

          {plan && current && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-2 bg-emerald-100 text-emerald-700">
                  {WEBSITE_PLANS[current].name} · Active
                </span>
                <h2 className="text-xl font-extrabold text-gray-900">Active until {fmtDate(plan.expiresAt!)}</h2>
                <p className="text-sm text-gray-500">Renewing early adds 12 months to your end date, plus that plan's credits.</p>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                {current === 'website' && (
                  <button onClick={() => buy('live_upgrade')} disabled={!!buying} className="px-5 py-2.5 rounded-xl text-sm font-bold text-white disabled:opacity-60" style={{ background: 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)' }}>
                    {buying === 'live_upgrade' ? 'Opening checkout…' : `Upgrade to Live · ${LIVE_UPGRADE.priceLabel}`}
                  </button>
                )}
                <button onClick={() => buy(current)} disabled={!!buying} className="px-5 py-2.5 rounded-xl text-sm font-semibold border border-gray-200 text-gray-800 hover:border-gray-300 disabled:opacity-60">
                  {buying === current ? 'Opening checkout…' : `Renew ${WEBSITE_PLANS[current].name} · ${WEBSITE_PLANS[current].priceLabel}`}
                </button>
              </div>
              {buyError && <p className="text-xs text-red-600 md:basis-full">{buyError}</p>}
            </div>
          )}

          {plan && !current && (
            <div className="space-y-3">
              <div>
                <h2 className="text-xl font-extrabold text-gray-900">{plan.expiresAt ? `Your plan ended on ${fmtDate(plan.expiresAt)}` : 'Choose a website plan'}</h2>
                <p className="text-sm text-gray-500">Yearly, all inclusive (GST included). <Link to="/websites" className="text-blue-600 font-semibold hover:underline">What's included →</Link></p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(['website', 'live'] as const).map(id => {
                  const p = WEBSITE_PLANS[id];
                  return (
                    <div key={id} className={`bg-white rounded-2xl p-6 flex flex-col ${id === 'live' ? 'border-2 border-blue-600' : 'border border-gray-200'}`}>
                      <p className="text-xs font-bold uppercase tracking-wider text-blue-700">{p.name}</p>
                      <p className="text-3xl font-extrabold text-gray-900 mt-2">{p.priceLabel}<span className="text-sm font-medium text-gray-500"> / year</span></p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 mt-1"><Sparkles size={11} className="text-orange-500" /> + {p.creditsLabel} ProfilePush credits</p>
                      <ul className="mt-4 space-y-1.5 text-sm text-gray-600 flex-1">{p.features.map(f => <li key={f} className="flex gap-2"><CheckCircle size={14} className="text-blue-600 mt-0.5 shrink-0" />{f}</li>)}</ul>
                      <button onClick={() => buy(id)} disabled={!!buying} className={`mt-5 px-5 py-3 rounded-xl text-sm font-bold disabled:opacity-60 ${id === 'live' ? 'text-white' : 'border border-gray-300 text-gray-900'}`} style={id === 'live' ? { background: 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)' } : undefined}>
                        {buying === id ? 'Opening checkout…' : `Activate ${p.name}`}
                      </button>
                    </div>
                  );
                })}
              </div>
              {buyError && <p className="text-xs text-red-600">{buyError}</p>}
            </div>
          )}

          {sites.map(site => <SiteManager key={site.id} site={site} onChanged={load} />)}

          {plan && plan.active && sites.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-600">
              Your plan is active. We're building your website; once it's ready you'll get a link to claim it, and its enquiries will show here.
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
