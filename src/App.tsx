import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import LandingPage from './pages/LandingPage';
import LogoSpinner from './components/LogoSpinner';
import { useAuth } from './contexts/AuthContext';
import { isSupabaseConfigured, supabaseConfigMissing } from './lib/supabase';

const SignUp = lazy(() => import('./pages/SignUp'));
const SignIn = lazy(() => import('./pages/SignIn'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Dashboard = lazy(() => import('./pages/Desk'));
const ProfilesDirectory = lazy(() => import('./pages/ProfilesDirectory'));
const ProfileDetails = lazy(() => import('./pages/ProfileDetails'));
const JobFinder = lazy(() => import('./pages/JobFinder'));
const WishlistPage = lazy(() => import('./pages/WishlistPage'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));
const SupportPage = lazy(() => import('./pages/SupportPage'));
const RoadmapPage = lazy(() => import('./pages/RoadmapPage'));
const BillingPage = lazy(() => import('./pages/BillingPage'));
const ResumeAIPage = lazy(() => import('./pages/ResumeAIPage'));
const CandidateOnboarding = lazy(() => import('./pages/CandidateOnboarding'));
const ConfirmApplied = lazy(() => import('./pages/ConfirmApplied'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsAndConditions = lazy(() => import('./pages/TermsAndConditions'));
const SecurityPage = lazy(() => import('./pages/SecurityPage'));
const TrackerPage = lazy(() => import('./pages/TrackerPage'));
const AIBenchMatch = lazy(() => import('./pages/AIBenchMatch'));
const AboutUs = lazy(() => import('./pages/AboutUs'));
const ContactUs = lazy(() => import('./pages/ContactUs'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const CancellationRefundPolicy = lazy(() => import('./pages/CancellationRefundPolicy'));
const ComparisonPage = lazy(() => import('./pages/ComparisonPage'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const BookDemo = lazy(() => import('./pages/BookDemo'));
const WhyAICopilot = lazy(() => import('./pages/WhyAICopilot'));
const HowItWorks = lazy(() => import('./pages/HowItWorks'));
const RadarPage = lazy(() => import('./pages/RadarPage'));

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <LogoSpinner size={32} />
    </div>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

// Keeps JobFinder mounted at all times so its state survives navigation.
// Visibility is toggled via CSS so the component never unmounts.
function PersistentJobFinder() {
  const { user } = useAuth();
  const location = useLocation();
  const active = location.pathname === '/job-finder' || location.pathname.startsWith('/job-finder/');

  if (!user) return null;

  return (
    <div style={{ display: active ? 'contents' : 'none' }}>
      <Suspense fallback={<PageLoader />}>
        <JobFinder />
      </Suspense>
    </div>
  );
}

function PersistentWishlist() {
  const { user } = useAuth();
  const location = useLocation();
  const active = location.pathname === '/submission-queue' || location.pathname.startsWith('/submission-queue/');

  if (!user) return null;

  return (
    <div style={{ display: active ? 'contents' : 'none' }}>
      <Suspense fallback={<PageLoader />}>
        <WishlistPage />
      </Suspense>
    </div>
  );
}

function PersistentResumeAI() {
  const { user } = useAuth();
  const location = useLocation();
  const active = location.pathname === '/resume-ai' || location.pathname.startsWith('/resume-ai/');

  if (!user) return null;

  return (
    <div style={{ display: active ? 'contents' : 'none' }}>
      <Suspense fallback={<PageLoader />}>
        <ResumeAIPage />
      </Suspense>
    </div>
  );
}

function SupabaseSetupRequired() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-6">
      <div className="max-w-2xl w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
        <h1 className="text-2xl font-semibold mb-3">Supabase Configuration Required</h1>
        <p className="text-slate-700 mb-4">
          This app cannot start because required environment variables are missing.
        </p>
        <div className="bg-slate-100 border border-slate-200 rounded-lg p-4 font-mono text-sm">
          <div>VITE_SUPABASE_URL {supabaseConfigMissing.url ? '(missing)' : '(set)'}</div>
          <div>VITE_SUPABASE_ANON_KEY {supabaseConfigMissing.anonKey ? '(missing)' : '(set)'}</div>
        </div>
        <div className="mt-4 text-sm text-slate-700 space-y-2">
          <p>Local dev: add these vars in your local env file and restart Vite.</p>
          <p>Production: add the same vars in your hosting provider environment settings and redeploy.</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  if (!isSupabaseConfigured) {
    return <SupabaseSetupRequired />;
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <ScrollToTop />
        <PersistentJobFinder />
        <PersistentWishlist />
        <PersistentResumeAI />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/onboard/:token" element={<CandidateOnboarding />} />
            <Route path="/confirm-applied/:token" element={<ConfirmApplied />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/terms" element={<TermsAndConditions />} />
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/about" element={<AboutUs />} />
            <Route path="/contact" element={<ContactUs />} />
            <Route path="/pricing" element={<PricingPage />} />
            <Route path="/cancellation-refund" element={<CancellationRefundPolicy />} />
            <Route path="/vs/:competitor" element={<ComparisonPage />} />
            <Route path="/book-demo" element={<BookDemo />} />
            <Route path="/why-ai-copilot" element={<WhyAICopilot />} />
            <Route path="/how-it-works" element={<HowItWorks />} />
            <Route path="/admin" element={<AdminDashboard />} />

            {/* Protected */}
            <Route path="/desk" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/bench" element={<ProtectedRoute><ProfilesDirectory /></ProtectedRoute>} />
            <Route path="/profile-details/:id" element={<ProtectedRoute><ProfileDetails /></ProtectedRoute>} />
            <Route path="/job-finder" element={<ProtectedRoute>{null}</ProtectedRoute>} />
            <Route path="/submission-queue" element={<ProtectedRoute>{null}</ProtectedRoute>} />
            <Route path="/resume-ai" element={<ProtectedRoute>{null}</ProtectedRoute>} />
            <Route path="/account" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
            <Route path="/support" element={<ProtectedRoute><SupportPage /></ProtectedRoute>} />
            <Route path="/roadmap" element={<ProtectedRoute><RoadmapPage /></ProtectedRoute>} />
            <Route path="/billing" element={<ProtectedRoute><BillingPage /></ProtectedRoute>} />
            <Route path="/tracker" element={<ProtectedRoute><TrackerPage /></ProtectedRoute>} />
            <Route path="/hotlist-ai" element={<ProtectedRoute><AIBenchMatch /></ProtectedRoute>} />
            <Route path="/job-watch-ai" element={<ProtectedRoute><RadarPage /></ProtectedRoute>} />
          </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}
