import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import SEO from '../components/SEO';

const LAST_UPDATED = 'July 9, 2026';

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
        description="ProfilePush cancellation and refund policy — how to cancel your subscription, when refunds are issued, and what happens to your data after cancellation."
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
              ProfilePush operates on a subscription-based model. This policy explains how cancellations are handled,
              when refunds may be issued, and what happens to your data and AI credits when a subscription ends.
              By using ProfilePush, you agree to the terms set out in this policy.
            </p>
          </Section>

          <Section title="2. Free Trial">
            <p>
              New accounts begin with a free trial period. No payment is required to start a trial. You may cancel
              at any time during the trial without being charged. At the end of the trial period, your account
              will require an active subscription to continue accessing paid features.
            </p>
          </Section>

          <Section title="3. Subscription Cancellation">
            <p>
              You may cancel your subscription at any time from the Billing section of your account settings.
              Cancellations take effect at the end of the current billing cycle. You will continue to have full
              access to all features until that date.
            </p>
            <p>
              ProfilePush does not charge cancellation fees. There are no lock-in contracts or minimum commitment periods.
            </p>
          </Section>

          <Section title="4. Refund Policy">
            <p>
              <strong>Monthly Subscriptions:</strong> We do not provide prorated refunds for partial months.
              If you cancel mid-cycle, you retain access through the end of the billing period, after which
              no further charges are made.
            </p>
            <p>
              <strong>Annual Subscriptions (if applicable):</strong> Refund requests for annual plans may be
              considered within 14 days of the billing date if the service has not been substantially used.
              To request a refund, contact us at{' '}
              <a href="mailto:poorna@profilepush.ai" className="text-blue-600 hover:underline">
                poorna@profilepush.ai
              </a>.
            </p>
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
              for any remaining subscription period or unused AI credits.
            </p>
            <p>
              If ProfilePush discontinues the service, we will provide at least 30 days' notice and issue
              prorated refunds for any unused subscription period.
            </p>
          </Section>

          <Section title="6. Data Retention After Cancellation">
            <p>
              After cancellation, your data (profiles, resumes, job searches, and activity logs) is retained for
              30 days. During this window you may reactivate your subscription and resume normal use.
              After 30 days, your data will be permanently deleted in accordance with our{' '}
              <Link to="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>.
            </p>
          </Section>

          <Section title="7. How to Request a Refund or Cancel">
            <p>
              To cancel your subscription: log in → go to <strong>Billing</strong> → click <strong>Cancel Plan</strong>.
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
