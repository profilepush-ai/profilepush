import { Link } from 'react-router-dom';

// The two pricing cards on the landing pages: Free and pay per match. There is
// no subscription. Prices mirror the Billing page: ₹0.25 a match, any amount
// from ₹100. Any purchase makes the account paid (up to 100 matches a day per
// consultant, choose the minimum match). The first-purchase offer (2× on ₹250
// and ₹500) only appears in the app, for an hour, so it's mentioned, not
// promised.

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
  '10 new matches a day per consultant',
  'Subscribe to 5 new people a day, up to 10',
  '100 free matches; only matches cost credits',
];

const PACK_BULLETS = [
  '₹0.25 a match: ₹250 buys 1,000',
  'Up to 100 matches a day per consultant',
  'Choose your minimum match, 50–80%',
  'Pay any amount from ₹100, no subscription',
  'Opening jobs, AI Submit, bulk send and Apply are free',
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
          Pay per match
        </span>
        <div className="flex items-baseline gap-1.5 mb-0.5">
          <span className="text-5xl font-extrabold text-gray-900">₹0.25</span>
          <span className="text-sm text-gray-500">a match</span>
        </div>
        <p className="text-xs text-gray-500 mb-8">Any amount from ₹100, top up when you need more</p>
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
