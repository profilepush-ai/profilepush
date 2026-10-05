import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, Bell, CheckCircle, Globe, Sparkles } from 'lucide-react';
import AppNav from '../components/AppNav';
import LogoSpinner from '../components/LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import { WEBSITE_PLAN } from '../lib/website-plan';
import WebsiteSubmissions from '../components/website/WebsiteSubmissions';
import {
  fetchMyWebsitePlan, fetchMyWebsites, startWebsiteCheckout,
  type MyWebsite, type WebsiteCheckoutResult, type WebsitePlanStatus,
} from '../lib/website-checkout';

// The account's Website Modernization plan (status, and the ₹29,999 yearly
// checkout, which also adds 5,000 credits) and each claimed website's
// enquiries. Analytics, domain and notification settings join this page as
// those parts are built.

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

const COMING = [
  { icon: BarChart3, t: 'Analytics', d: 'Visitors, sources and enquiry conversions.' },
  { icon: Globe, t: 'Domain', d: 'Connect your domain, with HTTPS.' },
  { icon: Bell, t: 'Notifications', d: 'Who gets enquiry alerts and the daily report.' },
];

export default function WebsitePage() {
  const { user, refreshAccount } = useAuth();
  const [plan, setPlan] = useState<WebsitePlanStatus | null>(null);
  const [sites, setSites] = useState<MyWebsite[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
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

  async function buy() {
    setBuying(true);
    setBuyError(null);
    try {
      const res = await startWebsiteCheckout({ name: user?.user_metadata?.full_name ?? '', email: user?.email ?? '' });
      if (res) {
        setResult(res);
        await Promise.all([load(), refreshAccount()]);
      }
    } catch (err) {
      setBuyError(err instanceof Error ? err.message : 'Failed to start checkout');
    }
    setBuying(false);
  }

  const renew = plan?.active ?? false;

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
                    Your website plan is active{result.planExpiresAt ? ` until ${fmtDate(result.planExpiresAt)}` : ''}, and {WEBSITE_PLAN.bonusCreditsLabel} credits
                    were added{result.balance !== null ? `. Balance: ${result.balance.toLocaleString('en-IN')} credits` : ''}.
                  </p>
                ) : (
                  <p>We're confirming it with Razorpay. Your plan and credits will appear here within a few minutes.</p>
                )}
              </div>
            </div>
          )}

          {plan && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 md:p-8">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                <div>
                  <span className={`inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-3 ${plan.active ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                    {plan.active ? 'Active' : plan.expiresAt ? 'Expired' : 'Website plan'}
                  </span>
                  <h2 className="text-2xl font-extrabold text-gray-900 mb-1">
                    {plan.active
                      ? `Active until ${fmtDate(plan.expiresAt!)}`
                      : plan.expiresAt
                        ? `Ended on ${fmtDate(plan.expiresAt)}`
                        : 'Your staffing website, rebuilt to get enquiries'}
                  </h2>
                  <p className="text-sm text-gray-500 max-w-md">
                    {plan.active
                      ? 'Renewing early adds 12 months to your current end date, plus another ' + WEBSITE_PLAN.bonusCreditsLabel + ' credits.'
                      : `${WEBSITE_PLAN.priceLabel} a year, all inclusive (GST included). Includes ${WEBSITE_PLAN.bonusCreditsLabel} ProfilePush credits.`}
                  </p>
                  {!plan.active && (
                    <Link to="/websites" className="inline-block mt-3 text-sm font-semibold text-blue-600 hover:underline">What's included →</Link>
                  )}
                </div>
                <div className="md:text-right shrink-0">
                  <p className="text-3xl font-extrabold text-gray-900">{WEBSITE_PLAN.priceLabel}<span className="text-sm font-medium text-gray-500"> / year</span></p>
                  <p className="text-xs text-gray-500 mb-3 flex md:justify-end items-center gap-1"><Sparkles size={11} className="text-orange-500" /> + {WEBSITE_PLAN.bonusCreditsLabel} credits</p>
                  <button
                    onClick={buy}
                    disabled={buying}
                    className="w-full md:w-auto px-6 py-3 rounded-xl text-sm font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-60 transition-opacity"
                    style={{ background: 'linear-gradient(135deg, #2563eb 0%, #0ea5e9 100%)' }}
                  >
                    {buying ? 'Opening checkout…' : renew ? 'Renew for 1 year' : 'Activate website plan'}
                  </button>
                  {buyError && <p className="text-xs text-red-600 mt-2 max-w-xs md:ml-auto">{buyError}</p>}
                </div>
              </div>
            </div>
          )}

          {sites.map(site => <WebsiteSubmissions key={site.id} site={site} />)}

          {plan && plan.active && sites.length === 0 && (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-sm text-gray-600">
              Your plan is active. We're building your website; once it's ready you'll get a link to claim it, and its enquiries will show here.
            </div>
          )}

          {plan && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {COMING.map(c => (
                <div key={c.t} className="bg-white rounded-2xl border border-gray-200 p-5 flex gap-3 opacity-70">
                  <span className="w-9 h-9 rounded-xl bg-gray-100 text-gray-500 flex items-center justify-center shrink-0"><c.icon size={16} /></span>
                  <div>
                    <p className="font-semibold text-gray-900 text-sm">{c.t} <span className="ml-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">Coming soon</span></p>
                    <p className="text-xs text-gray-500">{c.d}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
