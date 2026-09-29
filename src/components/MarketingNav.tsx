import { Link } from 'react-router-dom';
import { ArrowRight, Briefcase, UserRound } from 'lucide-react';
import Logo from './Logo';

// Single shared nav for every public marketing page (landing page, persona
// pages, IT-staffing list pages, How it Works, Why AI Copilot, Comparison)
// so navigating between them changes only what's active in the switcher/
// dropdown, not the whole header shell. `activePersona` is omitted on pages
// with no persona context (e.g. "/") — the switcher pills then render
// unhighlighted rather than defaulting to one side.
const PERSONA_LINKS = [
  { id: 'vendor', label: 'Vendor', icon: Briefcase, path: '/vendors' },
  { id: 'bench_sales', label: 'Bench Sales', icon: UserRound, path: '/bench-sales' },
] as const;


export default function MarketingNav({ activePersona }: { activePersona?: 'vendor' | 'bench_sales' }) {

  return (
    <nav className="fixed top-0 inset-x-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/">
          <Logo size="md" />
        </Link>

        <div className="flex items-center gap-3">
          <div className="flex shrink-0 items-center gap-1">
            {PERSONA_LINKS.map((option) => (
              <Link
                key={option.id}
                to={option.path}
                aria-current={activePersona === option.id ? 'page' : undefined}
                className={`inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition ${
                  activePersona === option.id
                    ? 'border border-blue-600 bg-blue-600 text-white'
                    : 'border border-transparent text-gray-500 hover:text-gray-900'
                }`}
              >
                <option.icon size={14} />
                <span className="hidden sm:inline">{option.label}</span>
              </Link>
            ))}
          </div>

        </div>

        <div className="flex items-center gap-3">
          <Link to="/signin" className="hidden sm:block text-sm text-gray-500 hover:text-gray-900 transition-colors">
            Sign In
          </Link>
          <Link
            to="/signup"
            className="bg-blue-600 hover:bg-blue-700 transition-colors text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5"
          >
            Start Free <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </nav>
  );
}
