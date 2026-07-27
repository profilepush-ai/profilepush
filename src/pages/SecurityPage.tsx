import { Link } from 'react-router-dom';
import { ShieldCheck, Lock, Server, Eye, CreditCard } from 'lucide-react';
import Logo from '../components/Logo';
import SEO from '../components/SEO';

const LAST_UPDATED = 'July 10, 2026';

const PILLARS = [
  {
    icon: Lock,
    title: 'AI Data Privacy & Strict Isolation',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    items: [
      'Zero-Training Guarantee — enterprise API agreements with all LLM providers; candidate resumes and job descriptions are never used to train our base models or third-party models.',
      'Prompt Isolation — data is injected into LLM prompts securely via API, isolated per request, and immediately discarded by the AI processor upon generating the output.',
    ],
  },
  {
    icon: Server,
    title: 'Infrastructure & Encryption',
    color: 'text-green-600',
    bg: 'bg-green-50',
    items: [
      'Data at Rest — all databases, including candidate profiles and uploaded PDF resumes, are encrypted at rest using AES-256 encryption.',
      'Data in Transit — all communications between your browser, our backend, and third-party APIs are encrypted in transit using industry-standard TLS 1.2 or higher.',
    ],
  },
  {
    icon: Eye,
    title: 'Access Control & Logging',
    color: 'text-orange-600',
    bg: 'bg-orange-50',
    items: [
      'Authentication & Unlimited Users — our Pro Plan allows unlimited users across all tiers, but access requires secure, individual login credentials.',
      'Granular Activity Intelligence — every action (searches, parses, emails generated) is logged with a timestamp attributed to specific user accounts, serving as both an operational dashboard and a strict security audit log to monitor for unauthorized data egress.',
      'Internal Access — ProfilePush staff access to production databases is strictly limited by role and requires explicit logging and authorization.',
    ],
  },
  {
    icon: CreditCard,
    title: 'Payment Security & Compliance',
    color: 'text-teal-600',
    bg: 'bg-teal-50',
    items: [
      'PCI-DSS Compliance — Razorpay is a highly secure, PCI-DSS Level 1 compliant payment processor.',
      'Tokenization — we do not store raw credit card information. All billing data is vaulted and tokenized securely by Razorpay.',
      'Tier & Upgrade Safety — when processing a mid-cycle tier upgrade to restore wallet credits, Razorpay securely recalculates the billing shift and authenticates the transactional difference in accordance with prevailing banking regulations.',
    ],
  },
];

export default function SecurityPage() {
  return (
    <div className="min-h-screen bg-white">
      <SEO
        title="Security | ProfilePush"
        description="ProfilePush implements enterprise-grade security — AES-256 encryption, TLS 1.2+ in transit, zero-training LLM data isolation, and PCI-DSS compliant payments via Razorpay."
        canonical="https://profilepush.ai/security"
      />
      <header className="border-b border-gray-100 bg-white/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/"><Logo size="sm" /></Link>
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">← Back to Home</Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-14 text-center">
          <p className="text-sm font-semibold text-blue-600 uppercase tracking-wider mb-3">Trust & Safety</p>
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-4">Security at ProfilePush</h1>
          <p className="text-gray-500 max-w-xl mx-auto leading-relaxed">At ProfilePush, we implement enterprise-grade security protocols to ensure your recruitment pipeline remains strictly confidential.</p>
          <p className="text-gray-400 text-sm mt-3">Last updated: {LAST_UPDATED}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
          {PILLARS.map(({ icon: Icon, title, color, bg, items }) => (
            <div key={title} className="border border-gray-100 rounded-2xl p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-3 mb-4">
                <div className={`w-9 h-9 rounded-xl ${bg} flex items-center justify-center`}>
                  <Icon size={18} className={color} />
                </div>
                <h2 className="text-base font-bold text-gray-900">{title}</h2>
              </div>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[14px] text-gray-600 leading-snug">
                    <span className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${color.replace('text-', 'bg-')}`} />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Responsible disclosure */}
        <div className="rounded-2xl bg-gray-50 border border-gray-100 p-8 text-center">
          <ShieldCheck size={28} className="text-blue-600 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-gray-900 mb-2">Responsible Disclosure</h2>
          <p className="text-gray-500 text-sm max-w-lg mx-auto mb-6 leading-relaxed">
            If you discover a security vulnerability in ProfilePush, please report it responsibly. We ask that you give us reasonable time to investigate and remediate before public disclosure.
          </p>
          <a
            href="mailto:security@profilepush.ai"
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 transition-colors text-white text-sm font-semibold px-6 py-3 rounded-xl shadow-sm shadow-blue-200"
          >
            Report a Vulnerability
          </a>
          <p className="text-xs text-gray-400 mt-4">security@profilepush.ai</p>
        </div>
      </main>

      <footer className="border-t border-gray-100 py-8 px-6 mt-16 bg-gray-50">
        <div className="max-w-4xl mx-auto flex flex-wrap gap-4 items-center justify-between text-xs text-gray-400">
          <span>© {new Date().getFullYear()} ProfilePush. All rights reserved.</span>
          <div className="flex gap-4">
            <Link to="/privacy" className="hover:text-gray-600 transition-colors">Privacy Policy</Link>
            <Link to="/terms" className="hover:text-gray-600 transition-colors">Terms & Conditions</Link>
            <Link to="/security" className="hover:text-gray-600 transition-colors">Security</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
