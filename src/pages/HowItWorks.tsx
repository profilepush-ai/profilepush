import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import SEO from '../components/SEO';
import Logo from '../components/Logo';
import SiteFooter from '../components/SiteFooter';

const phases = [
  {
    number: '1',
    title: 'Organizing the Talent (The Bench)',
    tagline: 'Stop manually typing out consultant details.',
    points: [
      { label: 'Instant Parsing', text: "Upload your candidate's PDF resume. ProfilePush AI instantly reads the file and extracts their name, phone number, education, work history, core skills, and visa status into a clean digital profile." },
      { label: 'Priority Skills Auto-Generation', text: "The AI automatically suggests the top 5 priority skills based on the candidate's history, giving you an instant marketing angle for your search." },
      { label: 'Centralized Hub', text: 'Your entire team\'s active consultants live in one syncable dashboard. No more digging through desktop folders to find the "latest version" of a resume.' },
    ],
  },
  {
    number: '2',
    title: 'Sourcing Requirements (Omni-Board Search)',
    tagline: 'Stop switching between 15 browser tabs.',
    points: [
      { label: 'One Matrix, 4 Boards', text: 'Select your candidate, apply your filters (location, job type, timeline, seniority), and hit search. ProfilePush simultaneously sweeps LinkedIn, Dice, Indeed, and Monster.' },
      { label: 'Live Aggregation', text: 'Dozens of live, active requirements are fetched and loaded directly into a single, unified feed.' },
      { label: 'Quick Preview', text: 'Click any job to instantly preview the full Job Description and apply link without ever leaving the ProfilePush dashboard.' },
    ],
  },
  {
    number: '3',
    title: 'Qualifying the Fit (AI Match Scoring)',
    tagline: 'Stop guessing if your candidate will pass the ATS.',
    points: [
      { label: 'Instant Match Score', text: "Click the match icon on any job. The AI cross-references the live JD with your candidate's parsed profile and generates a definitive percentage match (e.g., 88%)." },
      { label: 'Skill Gap Analysis', text: 'The AI highlights exact strengths and flags critical missing requirements (like a missing location preference or specific tech stack).' },
      { label: 'The Routing System', text: 'Instantly route high-match jobs to your Submission Queue (for outreach) or your Resume Queue (for formatting).' },
    ],
  },
  {
    number: '4',
    title: 'Bypassing MS Word (AI Resume Rewrite)',
    tagline: 'Stop spending 20 minutes manually formatting margins and bolding keywords.',
    points: [
      { label: '10-Second Tailoring', text: "Go to your Resume Queue and click Rewrite Resume. The AI uses the skill gap analysis to automatically adjust the candidate's bullet points, highlighting the exact experience the Prime Vendor is asking for." },
      { label: 'Live Editor', text: 'View the rewritten profile, hide irrelevant skills with a single click, and toggle between different formatting styles.' },
      { label: 'Download & Go', text: "Download the perfectly tailored PDF instantly, or save it directly to the candidate's profile." },
    ],
  },
  {
    number: '5',
    title: 'Executing the Pitch (Submission Queue)',
    tagline: 'Stop typing generic "Please find attached" emails.',
    points: [
      { label: 'One-Click Email Generation', text: 'Inside your Submission Queue, click to generate a pitch email. The AI drafts a highly contextual, professional outreach email specifically designed for that exact role.' },
      { label: 'Client & Candidate Approvals', text: 'Generate a pitch for the hiring manager, or generate an approval email with an apply-link to send directly to your candidate.' },
      { label: 'Log the Submission', text: 'Mark the job as "Submission Initiated" to instantly log the activity.' },
    ],
  },
  {
    number: '6',
    title: 'Reverse Matching (Hotlist AI)',
    tagline: 'Got a hot req from a vendor on LinkedIn? Find the candidate instantly.',
    points: [
      { label: 'Paste the JD', text: 'Copy any raw job description from LinkedIn, an email thread, or social media and paste it into Hotlist AI.' },
      { label: 'Scan the Bench', text: 'The AI scans your entire Bench and Hotlist simultaneously.' },
      { label: 'Bulk Match', text: 'It automatically scores every available candidate against the JD, showing you exactly who to submit. Select the top matches and push them straight to the Submission Queue in one click.' },
    ],
  },
  {
    number: '7',
    title: 'Tracking & Team Scaling (The Desk)',
    tagline: 'Throw away your messy Excel sheets.',
    points: [
      { label: 'Automated CRM', text: 'Every time you execute a pitch, the Tracker logs the candidate, the vendor, and the submission status. Your desk builds its own CRM on autopilot, preventing double-submittals.' },
      { label: 'Unlimited Users', text: "Add your entire recruiting team. You don't pay per seat; you just share your AI credit pool." },
      { label: 'Usage Analytics', text: 'Total transparency. The dashboard shows exactly who is scraping jobs, matching resumes, and making submittals, down to the exact cent of AI credit usage.' },
    ],
  },
];

export default function HowItWorks() {
  return (
    <div className="min-h-screen bg-white">
      <SEO
        title="How it Works | ProfilePush"
        description="See how ProfilePush AI Copilot helps bench sales recruiters hit 10X submissions in 7 phases."
      />

      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-gray-100 bg-white/95 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/"><Logo size="md" /></Link>
          <div className="hidden md:flex items-center gap-8 text-sm text-gray-500">
            <Link to="/" className="hover:text-gray-900 transition-colors">Home</Link>
            <Link to="/pricing" className="hover:text-gray-900 transition-colors">Pricing</Link>
            <Link to="/why-ai-copilot" className="hover:text-gray-900 transition-colors">Why AI Co-pilot</Link>
            <Link to="/how-it-works" className="hover:text-gray-900 transition-colors">How it Works</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/signin" className="hidden sm:block text-sm text-gray-500 hover:text-gray-900 transition-colors">
              Sign In
            </Link>
            <Link
              to="/signup"
              className="bg-blue-600 hover:bg-blue-700 transition-colors text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1.5 shadow-sm"
            >
              Start Free <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </nav>

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
            to="/sign-up"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-blue-600 text-white font-semibold text-lg shadow-lg shadow-blue-600/25 hover:bg-blue-700 hover:shadow-blue-700/30 transition-all duration-200"
          >
            Start Free <ArrowRight size={13} />
          </Link>
          <p className="mt-4 text-sm text-gray-500">
            Includes $5 in monthly AI credits. No credit card required. Setup takes 10 seconds.
          </p>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
}
