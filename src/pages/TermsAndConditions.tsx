import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import SEO from '../components/SEO';

const LAST_UPDATED = 'September 7, 2026';

export default function TermsAndConditions() {
  return (
    <div className="min-h-screen bg-white">
      <SEO
        title="Terms & Conditions | ProfilePush"
        description="Read the ProfilePush Terms and Conditions. These terms govern your use of the ProfilePush AI sourcing copilot for professional recruitment and staffing agencies."
        canonical="https://profilepush.ai/terms"
      />
      <header className="border-b border-gray-100 bg-white/90 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/"><Logo size="sm" /></Link>
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">← Back to Home</Link>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-16">
        <div className="mb-12">
          <p className="text-sm font-semibold text-blue-600 uppercase tracking-wider mb-3">Legal</p>
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-4">Terms & Conditions</h1>
          <p className="text-gray-400 text-sm">Last updated: {LAST_UPDATED}</p>
        </div>

        <div className="prose prose-gray max-w-none space-y-10">
          <Section title="1. Acceptance of Terms">
            <p>By accessing or using ProfilePush ("Platform", "we", "us", or "our"), you agree to be bound by these Terms & Conditions. ProfilePush is a B2B Software-as-a-Service (SaaS) designed exclusively for professional recruitment and staffing agencies. It is not intended for consumer use.</p>
          </Section>

          <Section title="2. Description of Service">
            <p>ProfilePush is an AI copilot for US IT staffing teams — both bench sales recruiters (who have consultants and need requirements) and vendor/account management teams (who have requirements and need consultants). The Platform includes:</p>
            <ul>
              <li><strong>Pulse:</strong> a market-intelligence leaderboard ranking tech stacks by live job count, consultant count, and average rate.</li>
              <li><strong>Jobs and Hotlist:</strong> live feeds of client requirements and available bench consultants, aggregated from public social groups and job boards.</li>
              <li><strong>Video Screening:</strong> an automated, adaptive AI video interview run on candidates who apply to a job posted on ProfilePush — see Section 5.</li>
              <li><strong>Posts:</strong> a feature letting you list your own job requirement or consultant directly on the Platform, joining the same feeds other users browse.</li>
              <li><strong>Active List:</strong> a filterable, exportable list of contacts actively posting jobs or consultants.</li>
              <li><strong>AI Submit / AI Request:</strong> AI-drafted outreach email generation, sendable via your own connected Gmail account or ProfilePush's own delivery infrastructure.</li>
              <li><strong>Inbox:</strong> a unified conversation thread for outreach replies and in-app chats.</li>
              <li><strong>Tracker:</strong> a CRM for logging submissions against vendors and clients.</li>
            </ul>
          </Section>

          <Section title="3. Account Registration & Team Members">
            <p>Every ProfilePush account permits an unlimited number of authorized users from your organization, on both the Free plan and any paid Pro subscription tier — team members share one organizational AI credit balance. You are responsible for maintaining the confidentiality of your login credentials and for all activity under your organization's account.</p>
          </Section>

          <Section title="4. Billing, AI Credits, and Subscriptions">
            <p><strong>Free plan:</strong> Every new account receives 500 AI credits, granted once at signup, which never expire and are not refreshed on any recurring schedule. No credit card is required, and every feature of the Platform is accessible on the Free plan.</p>
            <p><strong>One-time credit top-ups:</strong> Additional credits can be purchased at any time in increments of 500, up to 5,000, at a flat rate of ₹1 per credit. Top-up credits never expire.</p>
            <p><strong>Pro subscription:</strong> You may optionally subscribe to have credits delivered automatically every billing cycle, choosing any amount from 500 to 5,000 credits per month at the same flat ₹1-per-credit rate. You may switch tiers or cancel at any time from Billing in your account settings; there is no minimum commitment period and no forced upgrade-only mechanic — running out of credits mid-cycle simply pauses AI-generation features until you top up or your next renewal, it does not lock your account.</p>
            <p><strong>What actually costs credits:</strong> Credits are charged only for genuine AI-generation actions — drafting an outreach or chat message (1 credit), or a candidate completing a Video Screening interview on a job you posted (50 credits, charged to your account as the job's owner). Browsing Pulse, Jobs, Hotlist, and Active List, previewing a post, revealing contact details, and creating a post or a job listing do not consume credits. Downloading contacts from Active List is limited to 50 contacts per rolling 24 hours per account, independent of your credit balance.</p>
            <p><strong>Payments via Razorpay:</strong> All billing — one-time top-ups and recurring subscription charges — is processed in Indian Rupees (INR) through Razorpay. Razorpay tokenizes and stores your payment method; ProfilePush never stores your raw card details.</p>
            <p><strong>Refunds:</strong> Billing charges are governed by our <Link to="/cancellation-refund">Cancellation &amp; Refund Policy</Link>, which takes precedence over this section on refund questions.</p>
          </Section>

          <Section title="5. Video Screening — AI Interviews of Candidates">
            <p>When a candidate applies to a job you have posted on ProfilePush, the Platform automatically initiates an adaptive AI video interview with that candidate: it records their camera and microphone in-browser, asks follow-up questions generated in response to their answers, transcribes their responses using AI, and produces a scored AI-generated summary alongside the full video recording. This runs automatically as part of the job-posting feature — you do not need to separately request or configure it.</p>
            <p><strong>Your responsibility as the job poster:</strong> By posting a job on ProfilePush, you acknowledge that applicants to that job will be recorded and evaluated by AI as described above, and you are solely responsible for ensuring that directing candidates to this process complies with the laws applicable to your hiring — including any state or local requirements to notify a candidate that AI will analyze a video interview, or to obtain their consent, before the interview takes place. ProfilePush does not currently present its own candidate-facing notice or consent screen before recording begins; if your jurisdiction requires one, you must communicate that notice to candidates yourself (for example, in your job posting or application instructions) before directing them to apply.</p>
            <p>You may not use Video Screening to evaluate candidates in a way that violates anti-discrimination law, and you remain solely responsible for hiring decisions made using the AI summary — the summary is a decision-support tool, not a hiring determination.</p>
          </Section>

          <Section title="6. Acceptable Use & Scraping Acknowledgement">
            <p>ProfilePush aggregates public job listings and consultant posts from social platforms and job boards using both its own automated systems and third-party data infrastructure (including Apify).</p>
            <ul>
              <li>You agree to use the Platform strictly for internal recruitment and staffing purposes.</li>
              <li>You agree not to reverse-engineer, mass-scrape our database, or use the Platform to build a competing product.</li>
              <li>You agree not to use Posts or Active List to harvest contact data for purposes unrelated to legitimate staffing outreach, and not to use Video Screening on anyone who has not actually applied through your own job posting.</li>
            </ul>
          </Section>

          <Section title="7. Intellectual Property & Candidate Data">
            <p>You retain ownership of the candidate data you or your candidates upload or generate through the Platform — including resumes, and the video recordings, transcripts, and AI summaries produced by Video Screening. You grant ProfilePush a limited, secure license to process this data solely to provide the service. ProfilePush retains all intellectual property rights to the Platform's code, UI, and proprietary AI workflows.</p>
          </Section>

          <Section title="8. Limitation of Liability">
            <p>To the maximum extent permitted by law, ProfilePush shall not be liable for any indirect, incidental, or consequential damages arising out of your use of the Platform, including any hiring decision made using a Video Screening AI summary. Our total liability is capped at the total fees paid by you in the three (3) months preceding the claim, or ₹5,000, whichever is greater.</p>
          </Section>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-100">{title}</h2>
      <div className="space-y-3 text-gray-600 leading-relaxed text-[15px]">{children}</div>
    </section>
  );
}
