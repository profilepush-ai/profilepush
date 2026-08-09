import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import LandingPage from './pages/LandingPage';
import LogoSpinner from './components/LogoSpinner';
import StartupSplash from './components/StartupSplash';
import UserActivityTracker from './components/UserActivityTracker';
import { useAuth } from './contexts/AuthContext';
import { isSupabaseConfigured, supabaseConfigMissing } from './lib/supabase';
import { initializeOneSignal, setOneSignalExternalUserId } from './lib/onesignal';

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
const CancellationRefundPolicy = lazy(() => import('./pages/CancellationRefundPolicy'));
const ComparisonPage = lazy(() => import('./pages/ComparisonPage'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminCommands = lazy(() => import('./pages/AdminCommands'));
const BookDemo = lazy(() => import('./pages/BookDemo'));
const WhyAICopilot = lazy(() => import('./pages/WhyAICopilot'));
const HowItWorks = lazy(() => import('./pages/HowItWorks'));
const RadarPage = lazy(() => import('./pages/RadarPage'));
const PulsePage = lazy(() => import('./pages/PulsePage'));
const ProfilesPage = lazy(() => import('./pages/ProfilesPage'));
const AlertsPage = lazy(() => import('./pages/AlertsPage'));
const WatchlistProfilesPage = lazy(() => import('./pages/WatchlistProfilesPage'));
const OnboardingVideo = lazy(() => import('./pages/OnboardingVideo'));

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

function OneSignalIdentitySync() {
  const { user } = useAuth();

  useEffect(() => {
    setOneSignalExternalUserId(user?.id ?? null);
  }, [user?.id]);

  return null;
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
  const [showStartupSplash, setShowStartupSplash] = useState(true);

  useEffect(() => {
    initializeOneSignal();
    const timer = window.setTimeout(() => setShowStartupSplash(false), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  if (!isSupabaseConfigured) {
    return <SupabaseSetupRequired />;
  }

  return (
    <>
      <StartupSplash hide={!showStartupSplash} />
      <BrowserRouter>
        <AuthProvider>
          <ScrollToTop />
          <OneSignalIdentitySync />
          <UserActivityTracker />
          <PersistentJobFinder />
          <PersistentWishlist />
          <PersistentResumeAI />
          <Suspense fallback={<PageLoader />}>
            <Routes>
            {/* Public */}
            <Route path="/" element={<ErrorBoundary><LandingPage /></ErrorBoundary>} />
            <Route path="/signup" element={<ErrorBoundary><SignUp /></ErrorBoundary>} />
            <Route path="/signin" element={<ErrorBoundary><SignIn /></ErrorBoundary>} />
            <Route path="/reset-password" element={<ErrorBoundary><ResetPassword /></ErrorBoundary>} />
            <Route path="/onboard/:token" element={<ErrorBoundary><CandidateOnboarding /></ErrorBoundary>} />
            <Route path="/welcome" element={<ProtectedRoute><ErrorBoundary><OnboardingVideo /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/confirm-applied/:token" element={<ErrorBoundary><ConfirmApplied /></ErrorBoundary>} />
            <Route path="/privacy" element={<ErrorBoundary><PrivacyPolicy /></ErrorBoundary>} />
            <Route path="/terms" element={<ErrorBoundary><TermsAndConditions /></ErrorBoundary>} />
            <Route path="/security" element={<ErrorBoundary><SecurityPage /></ErrorBoundary>} />
            <Route path="/about" element={<ErrorBoundary><AboutUs /></ErrorBoundary>} />
            <Route path="/contact" element={<ErrorBoundary><ContactUs /></ErrorBoundary>} />
            <Route path="/pricing" element={<Navigate to="/#pricing" replace />} />
            <Route path="/cancellation-refund" element={<ErrorBoundary><CancellationRefundPolicy /></ErrorBoundary>} />
            <Route path="/vs/:competitor" element={<ErrorBoundary><ComparisonPage /></ErrorBoundary>} />
            <Route path="/book-demo" element={<ErrorBoundary><BookDemo /></ErrorBoundary>} />
            <Route path="/why-ai-copilot" element={<ErrorBoundary><WhyAICopilot /></ErrorBoundary>} />
            <Route path="/how-it-works" element={<ErrorBoundary><HowItWorks /></ErrorBoundary>} />
            <Route path="/admin" element={<ErrorBoundary><AdminDashboard /></ErrorBoundary>} />
            <Route path="/admin/commands" element={<ErrorBoundary><AdminCommands /></ErrorBoundary>} />

            {/* Protected */}
            <Route path="/desk" element={<ProtectedRoute><Navigate to="/jobs" replace /></ProtectedRoute>} />
            <Route path="/bench" element={<ProtectedRoute><Navigate to="/jobs" replace /></ProtectedRoute>} />
            <Route path="/profile-details/:id" element={<ProtectedRoute><ErrorBoundary><ProfileDetails /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/job-finder" element={<ProtectedRoute><Navigate to="/jobs" replace /></ProtectedRoute>} />
            <Route path="/submission-queue" element={<ProtectedRoute><Navigate to="/jobs" replace /></ProtectedRoute>} />
            <Route path="/resume-ai" element={<ProtectedRoute><ErrorBoundary>{null}</ErrorBoundary></ProtectedRoute>} />
            <Route path="/account" element={<ProtectedRoute><ErrorBoundary><AccountSettings /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/support" element={<ProtectedRoute><ErrorBoundary><SupportPage /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/roadmap" element={<ProtectedRoute><ErrorBoundary><RoadmapPage /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/billing" element={<ProtectedRoute><ErrorBoundary><BillingPage /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/tracker" element={<ProtectedRoute><ErrorBoundary><TrackerPage /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute><ErrorBoundary><AlertsPage /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/jd-ai" element={<ProtectedRoute><Navigate to="/jobs" replace /></ProtectedRoute>} />
            <Route path="/job-watch-ai" element={<ProtectedRoute><Navigate to="/jobs" replace /></ProtectedRoute>} />
            <Route path="/jobs" element={<ProtectedRoute><ErrorBoundary><PulsePage /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/pulse" element={<ProtectedRoute><ErrorBoundary><ProfilesPage /></ErrorBoundary></ProtectedRoute>} />
            <Route path="/watchlist-profiles" element={<ProtectedRoute><ErrorBoundary><WatchlistProfilesPage /></ErrorBoundary></ProtectedRoute>} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </>
  );
}
