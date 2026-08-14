import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, MessageSquare, CheckCircle } from 'lucide-react';
import Logo from '../components/Logo';
import LogoSpinner from '../components/LogoSpinner';
import SEO from '../components/SEO';

const WEBHOOK_URL = 'https://services.leadconnectorhq.com/hooks/48XyGfN1WxneooOcHGHn/webhook-trigger/5acdf9f6-c8e2-44ea-91be-163a46cf83fd';

export default function ContactUs() {
  const [name, setName]       = useState('');
  const [email, setEmail]     = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent]       = useState(false);
  const [error, setError]     = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      setError('Please fill in all required fields.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'contact form submission',
          name: name.trim(),
          email: email.trim(),
          subject: subject.trim() || '(no subject)',
          message: message.trim(),
        }),
      });
      setSent(true);
    } catch {
      setError('Something went wrong. Please try emailing us directly.');
    }
    setSending(false);
  }

  return (
    <div className="min-h-screen bg-white">
      <SEO
        title="Contact ProfilePush — AI Copilot for US IT Staffing Teams"
        description="Get in touch with the ProfilePush team. Email us at poorna@profilepush.ai or use the contact form. We respond within 1 business day."
        canonical="https://profilepush.ai/contact"
      />
      <header className="border-b border-gray-100 bg-white/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/"><Logo size="sm" /></Link>
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">← Back to Home</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-16">
        <div className="mb-12">
          <p className="text-sm font-semibold text-blue-600 uppercase tracking-wider mb-3">Contact Us</p>
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-4">Get in touch</h1>
          <p className="text-gray-500 text-lg leading-relaxed max-w-xl">
            Have a question, feedback, or need help with your account? We'd love to hear from you.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-12">

          {/* Left — info */}
          <div className="lg:col-span-2 space-y-8">
            <div className="flex gap-4">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <Mail size={18} className="text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-sm mb-1">Email us</p>
                <a href="mailto:poorna@profilepush.ai" className="text-sm text-blue-600 hover:underline">
                  poorna@profilepush.ai
                </a>
                <p className="text-xs text-gray-400 mt-1">We typically respond within 1 business day.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center">
                <MessageSquare size={18} className="text-orange-500" />
              </div>
              <div>
                <p className="font-semibold text-gray-900 text-sm mb-1">LinkedIn</p>
                <a
                  href="https://www.linkedin.com/company/profile-push/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline"
                >
                  linkedin.com/company/profile-push
                </a>
                <p className="text-xs text-gray-400 mt-1">Follow us for product updates and tips.</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-xl p-5">
              <p className="text-sm font-semibold text-gray-900 mb-2">Office Hours</p>
              <p className="text-sm text-gray-500">Monday – Friday</p>
              <p className="text-sm text-gray-500">9:00 AM – 6:00 PM IST</p>
            </div>
          </div>

          {/* Right — form */}
          <div className="lg:col-span-3">
            {sent ? (
              <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
                <div className="w-14 h-14 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center">
                  <CheckCircle size={26} className="text-blue-600" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Message sent!</h2>
                <p className="text-sm text-gray-500 max-w-xs">
                  Thanks for reaching out. We'll get back to you within 1 business day.
                </p>
                <button
                  onClick={() => { setSent(false); setName(''); setEmail(''); setSubject(''); setMessage(''); }}
                  className="text-sm text-blue-600 hover:underline mt-2"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                    {error}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">Name *</label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Jane Smith"
                      className="w-full border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">Email *</label>
                    <input
                      type="email"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="jane@example.com"
                      className="w-full border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={e => setSubject(e.target.value)}
                    placeholder="How can we help?"
                    className="w-full border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1.5">Message *</label>
                  <textarea
                    value={message}
                    onChange={e => setMessage(e.target.value)}
                    rows={5}
                    placeholder="Tell us what's on your mind…"
                    className="w-full border border-gray-200 text-gray-900 placeholder-gray-400 text-sm rounded-lg px-3.5 py-2.5 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-all resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={sending}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold px-6 py-2.5 rounded-lg flex items-center gap-2 transition-colors shadow-sm shadow-blue-200 text-sm"
                >
                  {sending ? <><LogoSpinner size={14} /> Sending…</> : 'Send Message'}
                </button>
              </form>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-gray-100 py-8 mt-12 px-6 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} ProfilePush · AI Copilot for US IT Staffing Teams
      </footer>
    </div>
  );
}
