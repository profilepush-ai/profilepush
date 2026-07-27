import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import LogoSpinner from './LogoSpinner';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <LogoSpinner size={20} />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/signin" state={{ from: location.pathname + location.search }} replace />;
  }

  return <>{children}</>;
}
