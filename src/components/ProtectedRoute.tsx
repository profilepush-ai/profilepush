import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LogoSpinner from './LogoSpinner';
import PersonaGateScreen from './PersonaGateScreen';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, account, accountLoading } = useAuth();
  const location = useLocation();

  if (loading || accountLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LogoSpinner size={20} />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/signin" state={{ from: location.pathname + location.search }} replace />;
  }

  // Hard, non-skippable gate — covers both a brand-new signup and any
  // pre-existing account that never declared a persona. Only meaningful
  // once an account actually exists (a user with no account row at all
  // isn't something this gate should block).
  if (account && account.active_persona == null) {
    return <PersonaGateScreen />;
  }

  return <>{children}</>;
}
