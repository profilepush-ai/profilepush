import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Linkedin, UserCheck } from 'lucide-react';
import SiteFooter from '../components/SiteFooter';
import SEO from '../components/SEO';
import Logo from '../components/Logo';

export default function BookDemo() {
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://go.profilepush.ai/js/form_embed.js';
    script.type = 'text/javascript';
    script.async = true;
    document.body.appendChild(script);
    return () => { document.body.removeChild(script); };
  }, []);

  return (
    <>
      <SEO
        title="Book a Demo Call | ProfilePush"
        description="Book a live ProfilePush demo to see Pulse, Jobs, Hotlist, Inbox, and Tracker in action — the AI copilot built to 10X placements for bench sales recruiters and vendor teams."
        canonical="https://profilepush.ai/book-demo"
      />

      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <Logo size="sm" />
          </Link>
          <Link to="/" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ArrowLeft size={14} />
            Back to Home
          </Link>
        </div>
      </header>

      <main className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
        {/* Hero Section */}
        <section className="pt-16 pb-10 px-6">
          <div className="max-w-3xl mx-auto text-center">
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900 tracking-tight leading-tight">
              Book a Demo Call
            </h1>
            <p className="mt-4 text-gray-500 text-base leading-relaxed max-w-xl mx-auto">
              See how ProfilePush can streamline your bench sales workflow. Our specialist will walk you through the platform and answer all your questions.
            </p>
          </div>
        </section>

        {/* Content Grid */}
        <section className="pb-20 px-6">
          <div className="max-w-5xl mx-auto grid lg:grid-cols-3 gap-10">
            {/* Specialist Card */}
            <div className="lg:col-span-1 order-2 lg:order-1">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden sticky top-20">
                <div className="h-2 bg-gradient-to-r from-blue-500 to-cyan-500" />
                <div className="p-6">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-4">
                    <UserCheck size={12} />
                    Your Onboarding Specialist
                  </div>

                  <div className="flex items-center gap-4 mb-5">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-white font-bold text-lg shadow-lg shadow-blue-200/50">
                      CP
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-gray-900">Chandra Potluri</h3>
                      <p className="text-xs text-gray-500 mt-0.5">Onboarding Specialist</p>
                    </div>
                  </div>

                  <p className="text-xs text-gray-600 leading-relaxed mb-5">
                    With 8 years of bench sales experience, Chandra brings deep industry knowledge to help you get the most out of ProfilePush from day one. He understands your daily challenges and will tailor the demo to your specific workflow.
                  </p>

                  <div className="space-y-3">
                    <a
                      href="https://www.linkedin.com/in/chandra-potluri-b78387168/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl bg-[#0A66C2]/5 hover:bg-[#0A66C2]/10 border border-[#0A66C2]/10 text-[#0A66C2] transition-colors"
                    >
                      <Linkedin size={14} />
                      <span className="text-xs font-semibold">Connect on LinkedIn</span>
                    </a>
                  </div>

                  <div className="mt-6 pt-5 border-t border-gray-100">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-3">What to expect</p>
                    <ul className="space-y-2.5">
                      {[
                        'Personalized platform walkthrough',
                        'Bench sales workflow optimization tips',
                        'Q&A and custom use-case discussion',
                        'Pricing & plan guidance',
                      ].map((item, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-1 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                          <span className="text-xs text-gray-600">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            {/* Calendar Embed */}
            <div className="lg:col-span-2 order-1 lg:order-2">
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-0">
                  <iframe
                    src="https://go.profilepush.ai/widget/booking/sqZu4sRFUOT1bGaRrKxw"
                    style={{ width: '100%', minHeight: '700px', border: 'none', overflow: 'hidden' }}
                    scrolling="no"
                    id="sqZu4sRFUOT1bGaRrKxw_1784299753079"
                    title="Book a Demo Call"
                  />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
