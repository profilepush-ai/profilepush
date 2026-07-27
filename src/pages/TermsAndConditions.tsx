import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import SEO from '../components/SEO';

const LAST_UPDATED = 'July 10, 2026';

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
            <p>ProfilePush provides an AI-powered sourcing copilot that includes resume parsing, omni-board job search aggregation, AI-driven job matching, resume rewriting, and email drafting.</p>
          </Section>

          <Section title="3. Account Registration & Unlimited User Seats">
            <p>ProfilePush operates on a single Pro Plan structure with multiple tiered levels. Regardless of the credit tier purchased, your active subscription permits an unlimited number of authorized users from your organization. You are strictly responsible for maintaining the confidentiality of your login credentials and for all activities that occur under your organization's account.</p>
          </Section>

          <Section title="4. Subscriptions, AI Wallet, and Tier Upgrades">
            <p><strong>100% Drawdown Wallet:</strong> ProfilePush operates on a prepaid minimum commitment model. You purchase a subscription tier in Indian Rupees (INR), which is deposited into your organizational "Credit Wallet" as US Dollar (USD) credits to be used across the platform.</p>
            <p><strong>Subscription Tiers:</strong> The available recurring subscription tiers are:</p>
            <ul>
              <li>₹2,500 translates to $25 in AI credits</li>
              <li>₹5,000 translates to $50 in AI credits</li>
              <li>₹10,000 translates to $100 in AI credits</li>
              <li>₹20,000 translates to $200 in AI credits</li>
              <li>₹30,000 translates to $300 in AI credits</li>
              <li>₹40,000 translates to $400 in AI credits</li>
              <li>₹50,000 translates to $500 in AI credits</li>
            </ul>
            <p><strong>Credit Consumption:</strong> Credits are consumed in real-time based on usage (e.g., ~$0.05 per parse, ~$0.15 per omni-search).</p>
            <p><strong>No Manual Top-Ups; Mandatory Upgrades:</strong> We do not offer standalone, manual credit top-ups. If your credit wallet reaches a zero balance mid-billing cycle, platform features will be paused. To resume usage and add credits immediately, you must log into your dashboard and upgrade your account to the next available higher subscription tier.</p>
            <p><strong>Payments via Razorpay:</strong> All subscription billing, credit card tokenization, and tier upgrades are securely processed through Razorpay. By subscribing, you authorize Razorpay to store your payment credentials securely and automatically charge your card on a recurring basis until you cancel or change your tier.</p>
            <p><strong>Non-Refundable:</strong> All tier payments and subscription charges are final, non-refundable, and non-transferable.</p>
          </Section>

          <Section title="5. Acceptable Use & Scraping Acknowledgement">
            <p>ProfilePush utilizes third-party APIs (including Apify) to aggregate public job listings from platforms such as LinkedIn, Dice, Indeed, and Monster.</p>
            <ul>
              <li>You agree to use the omni-board search strictly for internal recruitment purposes.</li>
              <li>You agree not to reverse-engineer, mass-scrape our database, or use the Platform to build a competing product.</li>
            </ul>
          </Section>

          <Section title="6. Intellectual Property & Candidate Data">
            <p>You retain all ownership rights to the candidate data (resumes in PDF format) you upload. You grant ProfilePush a limited, secure license to process this data solely for the purpose of providing the service. ProfilePush retains all intellectual property rights to the Platform's code, UI, and proprietary AI workflows.</p>
          </Section>

          <Section title="7. Limitation of Liability">
            <p>To the maximum extent permitted by law, ProfilePush shall not be liable for any indirect, incidental, or consequential damages arising out of your use of the Platform. Our total liability is capped at the total fees paid by you in the three (3) months preceding the claim.</p>
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
