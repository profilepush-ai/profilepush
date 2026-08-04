import { Link } from 'react-router-dom';
import Logo from './Logo';

export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-100 bg-gray-50 pt-12 pb-8 px-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-start gap-10 mb-10">
          {/* Brand */}
          <div className="flex-1">
            <Logo size="sm" />
            <p className="mt-3 text-xs text-gray-500 leading-relaxed max-w-[200px]">
              AI copilot built for Bench Sales recruiters and staffing desks.
            </p>
          </div>

          {/* Company */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-4">Company</p>
            <ul className="space-y-2.5">
              <li><Link to="/about" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">About Us</Link></li>
              <li><Link to="/contact" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Contact Us</Link></li>
              <li><Link to="/#pricing" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Pricing</Link></li>
            </ul>
          </div>

          {/* Get started */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-4">Get Started</p>
            <ul className="space-y-2.5">
              <li><Link to="/signup" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Sign Up Free</Link></li>
              <li><Link to="/signin" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Sign In</Link></li>
              <li><Link to="/book-demo" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Book a Demo</Link></li>
            </ul>
          </div>

          {/* Compare */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-4">Compare</p>
            <ul className="space-y-2.5">
              <li><Link to="/vs/ceipal" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">vs Ceipal</Link></li>
              <li><Link to="/vs/jobright-ai" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">vs Jobright.ai</Link></li>
              <li><Link to="/vs/drivetube-ai" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">vs DriveTube.ai</Link></li>
              <li><Link to="/vs/apply-nxt" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">vs Apply.nxt</Link></li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-4">Legal</p>
            <ul className="space-y-2.5">
              <li><Link to="/privacy" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Privacy Policy</Link></li>
              <li><Link to="/terms" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Terms &amp; Conditions</Link></li>
              <li><Link to="/cancellation-refund" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Cancellation &amp; Refund</Link></li>
              <li><Link to="/security" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Security</Link></li>
              <li><a href="/sitemap.xml" target="_blank" rel="noopener noreferrer" className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Sitemap</a></li>
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-gray-100 pt-6 flex flex-wrap items-center justify-between gap-4">
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} ProfilePush · Built for Bench Sales Recruiters
          </p>

          {/* Social icons */}
          <div className="flex items-center gap-3">
            <a
              href="https://www.linkedin.com/company/profile-push/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-[#0A66C2] hover:border-[#0A66C2]/30 transition-colors shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
              </svg>
            </a>
            <a
              href="https://www.facebook.com/profilepushh"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook"
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-[#1877F2] hover:border-[#1877F2]/30 transition-colors shadow-sm"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                <path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
