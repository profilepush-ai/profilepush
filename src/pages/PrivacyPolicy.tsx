import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import SEO from '../components/SEO';

const LAST_UPDATED = 'August 27, 2026';

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <SEO
        title="Privacy Policy | ProfilePush"
        description="Read the ProfilePush Privacy Policy. Understand how we collect, use, and protect customer and candidate data when you use the ProfilePush AI sourcing copilot."
        canonical="https://profilepush.ai/privacy"
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
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-4">Privacy Policy</h1>
          <p className="text-gray-400 text-sm">Last updated: {LAST_UPDATED}</p>
        </div>

        <div className="prose prose-gray max-w-none space-y-10">
          <Section title="1. Information We Collect">
            <p><strong>Customer Account Data:</strong> Names, email addresses, billing addresses, and payment information.</p>
            <p><strong>Candidate Data:</strong> Resumes, work histories, contact information, and other Personally Identifiable Information (PII) uploaded by your recruiters.</p>
            <p><strong>Usage Data:</strong> Logs of platform activity to populate your team's tracking dashboard.</p>
          </Section>

          <Section title="2. How We Use Your Information">
            <p>We use Customer Data to manage your Pro Plan subscription level and provide customer support. We use Candidate Data strictly to execute the automated workflows you request (parsing, matching, rewriting).</p>
          </Section>

          <Section title="3. AI Processing & Third-Party Sub-Processors">
            <p>To provide our services, we share necessary data with trusted sub-processors:</p>
            <ul>
              <li><strong>Large Language Models (LLMs):</strong> We use enterprise APIs (e.g., OpenAI, Anthropic). We enforce zero-retention policies. Your Candidate Data and system prompts are explicitly excluded from being used to train third-party AI models.</li>
              <li><strong>Supabase:</strong> Used for secure database storage and authentication.</li>
              <li><strong>Cloudflare:</strong> Used for edge processing, content delivery, and storage needs to support platform performance and reliability.</li>
              <li><strong>Razorpay:</strong> Used as our exclusive payment gateway for subscription management and automated tier adjustments. Razorpay securely tokens and handles all financial data; ProfilePush never stores raw credit card numbers on its servers.</li>
            </ul>
          </Section>

          <Section title="4. Data Protection & Security">
            <p>ProfilePush treats Candidate Data, Customer Account Data, and any data accessed through connected third-party accounts (including Gmail, see Section 5) as sensitive and applies the following safeguards:</p>
            <ul>
              <li><strong>Encryption at rest:</strong> All databases, including candidate profiles, uploaded resumes, and OAuth tokens for connected accounts, are encrypted at rest using AES-256 encryption.</li>
              <li><strong>Encryption in transit:</strong> All communications between your browser, our backend, and third-party APIs are encrypted in transit using TLS 1.2 or higher.</li>
              <li><strong>Access control:</strong> Platform access requires secure, individual login credentials. Every action is logged and attributed to a specific user account. ProfilePush staff access to production databases is strictly limited by role and requires explicit logging and authorization.</li>
              <li><strong>AI data isolation:</strong> Data sent to LLM providers for processing is isolated per request and discarded immediately after generating a response — see Section 3 for our zero-training guarantee with AI sub-processors.</li>
              <li><strong>Infrastructure:</strong> ProfilePush is built on SOC2 Type II compliant infrastructure providers (Supabase, Cloudflare).</li>
            </ul>
            <p>Full details are published on our <Link to="/security">Security page</Link>. To report a security vulnerability, contact <a href="mailto:security@profilepush.ai">security@profilepush.ai</a>.</p>
          </Section>

          <Section title="5. Google Gmail Integration (Optional Feature)">
            <p>ProfilePush offers an optional feature that lets a recruiter connect their own Gmail account so outreach emails to job posters and vendors are sent from the recruiter's real Gmail address instead of a shared ProfilePush address. This feature is off by default and only activates if you explicitly click "Connect Gmail" and grant permission through Google's own consent screen.</p>
            <p>When you connect your Gmail account, we request the following Google OAuth scope:</p>
            <ul>
              <li><strong>Send email on your behalf (gmail.send):</strong> used only to send the specific outreach or reply email you have reviewed and approved inside ProfilePush. We never send email without your direct action, and never send bulk or unsolicited email.</li>
            </ul>
            <p>ProfilePush does not request read access to your Gmail inbox. Replies from job posters and vendors arrive in your own Gmail account directly and are not synced into or stored by ProfilePush.</p>
            <p>ProfilePush's use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. We do not use Gmail data for advertising or marketing purposes, do not sell Gmail data to third parties, and do not use Gmail data to train AI or machine learning models, whether generalized or personalized. Gmail data is accessed by automated systems only, except where necessary for security purposes, to comply with applicable law, or with your explicit consent (for example, if you request customer support).</p>
            <p>Your Gmail OAuth tokens are encrypted at rest and are only ever decrypted by our backend systems to send a message on your behalf. You can disconnect Gmail at any time from Account Settings → Integrations, or by revoking ProfilePush's access directly at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">myaccount.google.com/permissions</a> — either action immediately stops all further sending.</p>
          </Section>

          <Section title="6. Data Retention and Deletion">
            <p>Candidate data is retained on your organizational "Bench" as long as your account is active. If you cancel your subscription or fail to maintain an active tier, you have 30 days to export your data before it is permanently anonymized or deleted from our active databases.</p>
          </Section>

          <Section title="7. Your Rights">
            <p>Since ProfilePush acts as a Data Processor, any requests regarding Candidate Data (access, deletion) must be managed by the Customer (the agency), and we will assist in fulfilling those requests.</p>
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
