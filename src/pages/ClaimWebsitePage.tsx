import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowRight, CheckCircle, ExternalLink, Sparkles } from 'lucide-react';
import SEO from '../components/SEO';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';
import { useAuth } from '../contexts/AuthContext';
import { WEBSITE_PLAN } from '../lib/website-plan';
import {
  claimWithActivePlan, fetchClaimableWebsite, fetchMyWebsitePlan, startWebsiteCheckout, websiteUrl,
  type ClaimableWebsite, type WebsitePlanStatus,
} from '../lib/website-checkout';

// /claim/:token — where a demo's "Claim this website" banner leads. Shows
// what's being claimed; signed in, it either takes the ₹36,999 payment (which
// claims the site) or, with a plan already running, claims it directly. The
// server checks the claimant's email against the firm we pitched.

export default function ClaimWebsitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { user, refreshAccount } = useAuth();
  const [site, setSite] = useState<ClaimableWebsite | null | undefined>(undefined);
  const [plan, setPlan] = useState<WebsitePlanStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ confirmed: boolean } | null>(null);

  useEffect(() => {
    fetchClaimableWebsite(token).then(setSite).catch(() => setSite(null));
  }, [token]);

  useEffect(() => {
    if (user) fetchMyWebsitePlan().then(setPlan).catch(() => setPlan({ expiresAt: null, active: false }));
  }, [user]);

  async function claim() {
    setBusy(true);
    setError(null);
    try {
      if (plan?.active) {
        await claimWithActivePlan(token);
        setDone({ confirmed: true });
      } else {
        const res = await startWebsiteCheckout({ name: user?.user_metadata?.full_name ?? '', email: user?.email ?? '' }, token);
        if (res) setDone({ confirmed: res.confirmed });
      }
      await refreshAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    }
    setBusy(false);
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <SEO title="Claim your website — ProfilePush" description="Claim the website ProfilePush rebuilt for your firm." />
      <header className="px-6 h-16 flex items-center border-b border-gray-100 bg-white">
        <Link to="/"><Logo size="md" /></Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-gray-200 shadow-xl p-6 md:p-8">{children}</div>
      </main>
    </div>
  );

  if (site === undefined) return shell(<div className="py-10 flex justify-center"><LogoSpinner /></div>);

  if (!site) {
    return shell(
      <div className="text-center">
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2">This link isn't valid</h1>
        <p className="text-gray-500 mb-6">Check the link in your email, or contact us and we'll send it again.</p>
        <Link to="/contact" className="text-blue-600 font-semibold hover:underline">Contact us</Link>
      </div>,
    );
  }

  if (done) {
    return shell(
      <div className="text-center">
        <div className="w-16 h-16 mx-auto rounded-full bg-emerald-500 text-white flex items-center justify-center mb-5"><CheckCircle size={30} /></div>
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2">{site.name}'s website is yours.</h1>
        <p className="text-gray-500 mb-6">
          {done.confirmed
            ? `It's live, and ${plan?.active ? 'it uses your current plan' : `${WEBSITE_PLAN.bonusCreditsLabel} credits were added to your account`}.`
            : 'Payment received. We are confirming it with Razorpay; your website goes live within a few minutes.'}
        </p>
        <button onClick={() => navigate('/website')} className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl">
          Go to your website dashboard <ArrowRight size={16} />
        </button>
      </div>,
    );
  }

  if (site.claimed || site.expired) {
    return shell(
      <div className="text-center">
        <h1 className="text-2xl font-extrabold text-gray-900 mb-2">{site.claimed ? 'Already claimed' : 'This demo has expired'}</h1>
        <p className="text-gray-500 mb-6">
          {site.claimed
            ? `${site.name}'s website has already been claimed. If that was you, open your website dashboard.`
            : 'Contact us and we will renew your demo.'}
        </p>
        <Link to={site.claimed ? '/website' : '/contact'} className="text-blue-600 font-semibold hover:underline">
          {site.claimed ? 'Website dashboard' : 'Contact us'}
        </Link>
      </div>,
    );
  }

  return shell(
    <>
      <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-4 bg-blue-50 text-blue-700">
        <Sparkles size={12} /> Your new website
      </span>
      <h1 className="text-3xl font-extrabold tracking-tight text-gray-900 mb-2">Claim {site.name}'s website</h1>
      <p className="text-gray-500 mb-5">
        Rebuilt from {site.source_url ? <span className="font-medium text-gray-700">{site.source_url.replace(/^https?:\/\//, '')}</span> : 'your current website'}, with candidate and vendor enquiry forms, an admin portal and analytics.
      </p>
      <a href={websiteUrl(site)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:underline mb-6">
        View the demo <ExternalLink size={13} />
      </a>

      <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 mb-6">
        <div className="flex items-baseline justify-between">
          <span className="font-semibold text-gray-900">Website plan</span>
          <span className="text-xl font-extrabold text-gray-900">{WEBSITE_PLAN.priceLabel}<span className="text-xs font-medium text-gray-500"> / year</span></span>
        </div>
        <p className="text-xs text-gray-500 mt-1">All inclusive (GST included) · {WEBSITE_PLAN.bonusCreditsLabel} ProfilePush credits free</p>
      </div>

      {!user ? (
        <>
          <p className="text-sm text-gray-600 mb-4">
            Sign in or create a free account{site.claim_domain ? <> with your <b>@{site.claim_domain}</b> email</> : ' with the email we contacted'} to claim it.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link to="/signup" state={{ from: `/claim/${token}` }} className="text-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl">Create account</Link>
            <Link to="/signin" state={{ from: `/claim/${token}` }} className="text-center border border-gray-300 hover:border-gray-400 text-gray-800 font-semibold py-3 rounded-xl">Sign in</Link>
          </div>
        </>
      ) : (
        <>
          <button onClick={claim} disabled={busy || plan === null} className="w-full inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold py-3.5 rounded-xl">
            {busy ? 'Working…' : plan?.active ? 'Claim with my active plan' : <>Pay {WEBSITE_PLAN.priceLabel} and claim <ArrowRight size={16} /></>}
          </button>
          <p className="text-xs text-gray-500 mt-3 text-center">Signed in as {user.email}</p>
          {error && <p className="text-sm text-red-600 mt-3 text-center">{error}</p>}
        </>
      )}
    </>,
  );
}
