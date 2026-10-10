import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import SEO from '../components/SEO';

const LAST_UPDATED = 'September 7, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
      <div className="space-y-3 text-gray-600 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

export default function CancellationRefundPolicy() {
  return (
    <div className="min-h-screen bg-white">
      <SEO
        title="Cancellation & Refund Policy | ProfilePush"
        description="ProfilePush refund policy — when refunds are issued for credit purchases, and what happens to your data after cancellation."
        canonical="https://profilepush.ai/cancellation-refund"
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
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight mb-4">Cancellation &amp; Refund Policy</h1>
          <p className="text-gray-400 text-sm">Last updated: {LAST_UPDATED}</p>
        </div>

        <div className="space-y-10">

          <Section title="1. Overview">
            <p>
              ProfilePush is free to use, with optional one-time purchases of AI credits. There are no subscriptions
              or recurring charges. This policy explains when refunds may be issued for credit purchases and what
              happens to your data when an account is closed.
              By using ProfilePush, you agree to the terms set out in this policy.
            </p>
          </Section>

          <Section title="2. Free Plan">
            <p>
              Every new account is free forever, with no payment or credit card required. New accounts receive
              100 credits (100 matches) at signup, granted once, which never expire — there is no trial period and
              no point at which the Free plan stops working. Every feature of the Platform is available on the Free
              plan, with up to 10 new matches a day; a one-time credit purchase adds
              credits and raises that to up to 100 a day.
            </p>
          </Section>

          <Section title="3. No Subscriptions">
            <p>
              ProfilePush does not sell subscriptions, so there is nothing to cancel and nothing renews. You are
              only charged when you choose to buy a credit pack.
            </p>
            <p>
              ProfilePush does not charge cancellation fees. There are no lock-in contracts or minimum commitment periods.
            </p>
          </Section>

          <Section title="4. Refund Policy">
            <p>
              <strong>AI Credit Top-Ups:</strong> Credits purchased as one-time top-ups are non-refundable once
              they have been added to your wallet, regardless of whether they have been used.
            </p>
            <p>
              <strong>Duplicate or Erroneous Charges:</strong> If you believe you have been charged in error,
              please contact us within 30 days of the charge. We will investigate and, if confirmed, issue a
              full refund for the erroneous amount.
            </p>
          </Section>

          <Section title="5. Account Termination by ProfilePush">
            <p>
              If we terminate your account for a violation of our Terms &amp; Conditions, no refund will be issued
              for unused AI credits.
            </p>
            <p>
              If ProfilePush discontinues the service, we will provide at least 30 days' notice so you can use
              your remaining credits.
            </p>
          </Section>

          <Section title="6. Data Retention After Account Closure">
            <p>
              After an account is closed, your data (profiles, resumes, job searches, and activity logs) is retained
              for 30 days. During this window you may reopen the account and resume normal use.
              After 30 days, your data will be permanently deleted in accordance with our{' '}
              <Link to="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>.
            </p>
          </Section>

          <Section title="7. How to Request a Refund or Close Your Account">
            <p>
              To close your account, email us from your account email address.
            </p>
            <p>
              To request a refund or for any billing enquiry, email us at{' '}
              <a href="mailto:poorna@profilepush.ai" className="text-blue-600 hover:underline">
                poorna@profilepush.ai
              </a>{' '}
              with your account email and a brief description of the issue. We respond within 2 business days.
            </p>
          </Section>

          <Section title="8. Changes to This Policy">
            <p>
              We may update this Cancellation &amp; Refund Policy from time to time. Material changes will be
              communicated by email or by a prominent notice within the platform. Continued use of the service
              after any changes constitutes acceptance of the updated policy.
            </p>
          </Section>

        </div>
      </main>

      <footer className="border-t border-gray-100 py-8 mt-12 px-6 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} ProfilePush · Built for Bench Sales Recruiters
      </footer>
    </div>
  );
}
