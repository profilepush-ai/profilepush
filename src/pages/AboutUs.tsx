import { Link } from 'react-router-dom';
import { Zap, Target, Users, Globe } from 'lucide-react';
import Logo from '../components/Logo';
import SEO from '../components/SEO';

const PILLARS = [
  {
    icon: Zap,
    title: 'Speed is everything',
    body: 'The IT market moves in hours, not days. We built every workflow so you can go from a raw resume to a submitted application without switching tabs or wasting time.',
  },
  {
    icon: Target,
    title: 'Built for Bench Sales',
    body: 'Not a generic HR tool. ProfilePush is purpose-built for the specific workflows of Bench Sales recruiters — from C2C placements to direct hires across every major job board.',
  },
  {
    icon: Users,
    title: 'Teams first',
    body: 'Whether you are a solo desk or a 50-person offshore pod, the platform scales with you. Every action is logged, every output is visible, and every team member is accountable.',
  },
  {
    icon: Globe,
    title: 'Offshore-ready',
    body: 'Most of the world\'s best recruiting talent sits offshore. ProfilePush is designed to give offshore teams the same tools and visibility as onshore ones — no proxy needed.',
  },
];

export default function AboutUs() {
  return (
    <div className="min-h-screen bg-white">
      <SEO
        title="About ProfilePush — AI Copilot for Bench Sales Recruiters"
        description="Learn about ProfilePush — the AI copilot purpose-built for Bench Sales recruiters and offshore recruiting teams. Our mission: make every recruiter on your team as effective as your best one."
        canonical="https://profilepush.ai/about"
      />
      <header className="border-b border-gray-100 bg-white/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/"><Logo size="sm" /></Link>
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">← Back to Home</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">

        {/* Hero */}
        <div className="mb-16 max-w-2xl">
          <p className="text-sm font-semibold text-blue-600 uppercase tracking-wider mb-3">About Us</p>
          <h1 className="text-4xl md:text-5xl font-extrabold text-gray-900 tracking-tight leading-tight mb-6">
            Built by recruiters,<br />for recruiters.
          </h1>
          <p className="text-lg text-gray-500 leading-relaxed">
            ProfilePush is an AI copilot designed from the ground up for Bench Sales recruiters and staffing desks.
            We exist to eliminate the busywork that keeps great recruiters from doing what they do best — placing candidates.
          </p>
        </div>

        {/* Mission */}
        <div className="bg-gray-50 rounded-2xl p-8 md:p-12 mb-16">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-4">Our Mission</p>
          <blockquote className="text-2xl md:text-3xl font-bold text-gray-900 leading-snug max-w-2xl">
            "Make every recruiter on your team as effective as your best one."
          </blockquote>
          <p className="text-gray-500 mt-6 leading-relaxed max-w-2xl">
            The gap between a good recruiter and a great one isn't talent — it's tools, time, and information.
            ProfilePush closes that gap by giving every desk AI-powered sourcing, matching, and outreach that used to require hours of manual work.
          </p>
        </div>

        {/* Pillars */}
        <div className="mb-16">
          <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-8">What we stand for</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {PILLARS.map(p => (
              <div key={p.title} className="flex gap-5">
                <div className="shrink-0 w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <p.icon size={18} className="text-blue-600" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 mb-1.5">{p.title}</h3>
                  <p className="text-sm text-gray-500 leading-relaxed">{p.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="border-t border-gray-100 pt-12 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <Link
            to="/signup"
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-xl text-sm transition-colors shadow-sm shadow-blue-200"
          >
            Start Free Trial
          </Link>
          <Link
            to="/contact"
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors font-medium"
          >
            Get in touch →
          </Link>
        </div>
      </main>

      <footer className="border-t border-gray-100 py-8 mt-12 px-6 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} ProfilePush · Built for Bench Sales Recruiters
      </footer>
    </div>
  );
}
