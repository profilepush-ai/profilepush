import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import SEO from '../components/SEO';
import SiteFooter from '../components/SiteFooter';
import MarketingNav from '../components/MarketingNav';

const phases = [
  // The current product, checked against the app (posting free with 3 open on
  // the free plan, 1 credit per Tracker match, AI Request draft free, AI Submit
  // draft 1 credit, Gmail send 1 credit refunded on failure, screening 10
  // credits to the vendor). The old phases described retired tools (multi-
  // board search, Resume AI, Submission Queue, JD AI) that now redirect to /feed.
  {
    number: '1',
    title: 'Post what you have',
    tagline: 'Paste it exactly as you have it.',
    points: [
      { label: 'A requirement', text: 'Paste the requirement text from an email or a job board. The AI fills in the skills, visa, rate and experience for you.' },
      { label: 'A whole hotlist', text: 'Bench sales can paste the hotlist table, up to 50 consultants at a time. Every consultant is read and posted together.' },
      { label: 'Free to post', text: 'Posting and editing are free. The free plan keeps 3 consultants or requirements open at a time; any credit pack removes that limit.' },
    ],
  },
  {
    number: '2',
    title: 'The AI Copilot reads the market',
    tagline: 'Stop scrolling hotlists and requirement emails.',
    points: [
      { label: 'The live market', text: 'New requirements and hotlist consultants arrive all day, thousands a month. Each one is read as it arrives.' },
      { label: 'Only what fits', text: 'Every arrival is matched against each consultant or requirement you posted. What does not fit falls away.' },
      { label: 'AI Match on demand', text: 'Paste any consultant or requirement for ranked matches with fit and skill gaps: 1 credit per result, up to 10 a run.' },
    ],
  },
  {
    number: '3',
    title: 'Matches land in your Tracker',
    tagline: 'A live column for every consultant and every requirement.',
    points: [
      { label: 'A column each', text: 'Each thing you posted gets its own column, and new matches land in it all day, newest first. Each new match costs 1 credit, up to 10 a day on the free plan (30 once you have bought credits).' },
      { label: 'No noise twice', text: 'Reposts are merged into one card, and anything you mark "Not a match" never comes back.' },
      { label: 'Alerts', text: 'A notification on your phone (Android app) or browser when strong matches land, and an email if matches are waiting while you are away.' },
    ],
  },
  {
    number: '4',
    title: 'Vendors: AI Request',
    tagline: 'One tap asks for the resume.',
    points: [
      { label: 'The ask writes itself', text: 'From a matched consultant, AI Request drafts an email to the bench recruiter asking for the resume, rate, visa and availability. The draft is free.' },
      { label: 'From your own Gmail', text: 'You review it and it sends from your connected Gmail. A send costs 1 credit, refunded if it fails.' },
      { label: 'Optional screening', text: 'Tick one box to include a short video screening link. You get a recording, a score and a summary; a finished screening costs 10 credits.' },
    ],
  },
  {
    number: '5',
    title: 'Bench sales: AI Submit',
    tagline: 'The pitch writes itself, resume attached.',
    points: [
      { label: 'Submit from the match', text: 'From a matched requirement, AI Submit writes the submission email with the resume attached. The draft costs 1 credit.' },
      { label: 'Submissions', text: 'Submitting in the app is free. An AI Submit email costs 1 credit to draft and 1 credit to send from your Gmail, refunded if the send fails.' },
      { label: 'Inbound requests', text: 'When a vendor asks for a resume from your hotlist, it lands in one list with a clear status. Upload the resume, add a note, done. Replying never costs a credit.' },
    ],
  },
  {
    number: '6',
    title: 'Your team and your credits',
    tagline: 'No seats, no subscription.',
    points: [
      { label: 'Unlimited members', text: 'Add your whole team to one account. Everyone shares one credit balance.' },
      { label: 'Start free', text: '100 free credits at signup that never expire, plus 10 on your first post and 10 on your first submission.' },
      { label: 'Credit packs', text: 'One-time packs from ₹249, at ₹1 a credit. No subscription. Every credit spent is listed in Billing.' },
    ],
  },
];

const HOW_IT_WORKS_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'How ProfilePush works for vendors and bench sales recruiters',
  description: 'Post a requirement or paste a hotlist, let the AI Copilot match it against the live US IT staffing market, and act on the matches in your Tracker with AI Request and AI Submit.',
  step: phases.map((phase, index) => ({
    '@type': 'HowToStep',
    position: index + 1,
    name: phase.title,
    text: phase.tagline,
  })),
};

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-white">
      <SEO
        title="How ProfilePush Works: AI Copilot for US IT Staffing"
        description="Post a requirement or paste a hotlist. The AI Copilot matches it to the live market, fills your Tracker, and writes the email from your own Gmail."
        canonical="https://profilepush.ai/how-it-works"
        jsonLd={HOW_IT_WORKS_JSONLD}
      />

      <MarketingNav />

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-slate-50 to-white pt-32 pb-16 sm:pt-40 sm:pb-20">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-40 -right-40 w-[600px] h-[600px] rounded-full bg-blue-50/60 blur-3xl" />
          <div className="absolute -bottom-40 -left-40 w-[500px] h-[500px] rounded-full bg-orange-50/50 blur-3xl" />
        </div>

        <div className="relative max-w-5xl mx-auto px-4 sm:px-6 text-center">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 text-blue-700 text-sm font-semibold mb-6">
            Full Walkthrough
          </span>
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight mb-6 leading-[1.1]">
            <span className="bg-gradient-to-r from-blue-600 via-orange-500 to-yellow-400 bg-clip-text text-transparent">How it Works</span>
          </h1>
          <p className="text-lg sm:text-xl text-gray-600 max-w-2xl mx-auto mb-12">
            Watch the full platform walkthrough, then explore each phase below.
          </p>

          {/* Loom video embed */}
          <div className="max-w-4xl mx-auto">
            <div className="overflow-hidden rounded-2xl border border-gray-200 shadow-2xl shadow-gray-300/40 ring-1 ring-gray-100/80 bg-white">
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                <iframe
                  src="https://www.loom.com/embed/e4d985b799fe49f69f4f509d48d0cb98"
                  frameBorder="0"
                  allowFullScreen
                  className="absolute top-0 left-0 w-full h-full"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Phase cards */}
      <section className="py-20 sm:py-28 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="space-y-16 sm:space-y-24">
            {phases.map((phase) => (
                <div key={phase.number}>
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3">
                      Phase {phase.number}: {phase.title}
                    </h2>

                    <p className="text-gray-500 font-medium text-lg mb-6 italic">
                      {phase.tagline}
                    </p>

                    <ul className="space-y-4">
                      {phase.points.map((point) => (
                        <li key={point.label} className="flex gap-3">
                          <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-blue-500" />
                          <div>
                            <span className="font-semibold text-gray-900">{point.label}:</span>{' '}
                            <span className="text-gray-600">{point.text}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 sm:py-28 bg-gradient-to-b from-white to-slate-50">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-gray-900 mb-4">
            Ready to stop typing and start closing?
          </h2>
          <p className="text-lg text-gray-600 mb-10 max-w-xl mx-auto">
            Join the Bench Sales teams using ProfilePush to automate the grunt work and scale their submittals.
          </p>
          <Link
            to="/signup"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-blue-600 text-white font-semibold text-lg shadow-lg shadow-blue-600/25 hover:bg-blue-700 hover:shadow-blue-700/30 transition-all duration-200"
          >
            Start Free <ArrowRight size={13} />
          </Link>
          <p className="mt-4 text-sm text-gray-500">
            100 free credits that never expire. No credit card required.
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
