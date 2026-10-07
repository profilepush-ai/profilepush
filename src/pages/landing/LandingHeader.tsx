import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

// The header of the three marketing pages (/, /vendors, /bench-sales), in the
// design of the approved demos. It renders inside each page's scoped root, so
// it takes that page's styles. Phones get a compact "Start free" next to
// "Sign in"; a signed-in visitor gets "Open app" instead of both.

type Active = 'vendors' | 'bench-sales' | null;

function Chev() {
  return (
    <svg className="chev" aria-hidden="true">
      <use href="#chev" />
    </svg>
  );
}

export default function LandingHeader({ active, startPath }: { active: Active; startPath: string }) {
  const { user } = useAuth();
  const cur = (k: Active) => (active === k ? ({ 'aria-current': 'page' } as const) : {});
  return (
    <header className="top">
      <div className="wrap">
        <Link className="logo" to="/" aria-label="ProfilePush home">
          ProfilePush
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="5" cy="6.4" r="3.6" fill="#facc15" />
            <circle cx="5" cy="17.6" r="3.6" fill="#f97316" />
            <path d="M12.6 3.4 20.4 12l-7.8 8.6" fill="none" stroke="#2563eb" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <nav className="nav" aria-label="Main">
          <Link to="/vendors" {...cur('vendors')}>Vendors</Link>
          <Link to="/bench-sales" {...cur('bench-sales')}>Bench sales</Link>
          <Link className="hide-md" to="/websites" data-path="websites">Websites</Link>
          {user ? (
            <Link className="btn btn-p" to="/home">Open app <Chev /></Link>
          ) : (
            <>
              <Link to="/signin">Sign in</Link>
              <Link className="btn btn-p" to="/signup" data-path={startPath}>Start free <Chev /></Link>
            </>
          )}
        </nav>
        <div className="lp-m">
          {user ? (
            <Link className="btn btn-p" to="/home">Open app <Chev /></Link>
          ) : (
            <>
              <Link className="signin-m" to="/signin">Sign in</Link>
              <Link className="btn btn-p" to="/signup" data-path={startPath}>Start free <Chev /></Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
