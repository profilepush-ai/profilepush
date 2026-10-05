import { Link } from 'react-router-dom';

// The two pricing cards on the landing pages: Free and one-time credit packs
// (from ₹249). There is no subscription. Prices mirror the Billing page:
// 249, 500, 1,000 … 5,000 credits at ₹1 a credit. Any purchase makes the
// account paid (unlimited open posts, the bigger Network allowance). The
// first-purchase offer (2× on the ₹249 and ₹500 packs) only appears in the
// app, for an hour, so it's mentioned, not promised.

const CHECK_DARK = 'M1.5 4L3.5 6L6.5 2';

function Bullet({ children, tone }: { children: string; tone: 'yellow' | 'blue' | 'white' }) {
  const dot = tone === 'yellow' ? 'bg-yellow-100' : tone === 'blue' ? 'bg-blue-100' : 'bg-white/20';
  const stroke = tone === 'yellow' ? '#ca8a04' : tone === 'blue' ? '#2563eb' : 'white';
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 w-4 h-4 rounded-full ${dot} flex items-center justify-center shrink-0`}>
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d={CHECK_DARK} stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </span>
      {children}
    </li>
  );
}

export const DEFAULT_FREE_BULLETS = [
  'All features included',
  'Unlimited team members',
  '3 open consultants or requirements on the Tracker',
  'Subscribe to 5 new people a day, up to 10',
  '1 credit per AI Match result, AI draft or Gmail send',
];

const PACK_BULLETS = [
  'Pay once, credits never expire',
  'Unlimited open consultants or requirements',
  'Subscribe to 10 new people a day, no cap',
  '249, 500, 1,000 … up to 5,000 credits',
  '₹1 per credit, no subscription',
  'First top-up? Look for the 2× offer in the app',
];

export default function PricingCards({ freeBullets = DEFAULT_FREE_BULLETS }: {
  freeBullets?: string[];
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-3xl mx-auto">
      {/* Free */}
      <div className="bg-white rounded-2xl border border-gray-200 p-8 flex flex-col">
        <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-6 bg-yellow-100 text-yellow-700 w-fit">
          Free
        </span>
        <div className="flex items-baseline gap-1.5 mb-0.5">
          <span className="text-5xl font-extrabold text-gray-900">₹0</span>
          <span className="text-gray-500 text-sm">/ month</span>
        </div>
        <p className="text-xs text-gray-500 mb-8">100 credits, one time · no card required</p>
        <ul className="space-y-3 text-sm text-gray-600 flex-1 mb-8">
          {freeBullets.map((item) => <Bullet key={item} tone="yellow">{item}</Bullet>)}
        </ul>
        <Link to="/signup" className="w-full text-center border border-gray-300 hover:border-gray-400 bg-white hover:bg-gray-50 text-gray-800 text-sm font-semibold py-3 rounded-xl transition-colors">
          Get Started Free
        </Link>
      </div>

      {/* Credit packs */}
      <div className="bg-white rounded-2xl border-2 border-blue-600 p-8 flex flex-col relative">
        <span className="absolute -top-3 left-8 text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-sm text-white bg-blue-600">One-time</span>
        <span className="inline-flex items-center text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full mb-6 bg-blue-50 text-blue-700 w-fit">
          Credit packs
        </span>
        <div className="flex items-baseline gap-1.5 mb-0.5">
          <span className="text-sm text-gray-500">from</span>
          <span className="text-5xl font-extrabold text-gray-900">₹249</span>
        </div>
        <p className="text-xs text-gray-500 mb-8">Top up only when you need more</p>
        <ul className="space-y-3 text-sm text-gray-600 flex-1 mb-8">
          {PACK_BULLETS.map((item) => <Bullet key={item} tone="blue">{item}</Bullet>)}
        </ul>
        <Link to="/signup" className="w-full text-center bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-3 rounded-xl transition-colors">
          Get Started
        </Link>
      </div>
    </div>
  );
}
