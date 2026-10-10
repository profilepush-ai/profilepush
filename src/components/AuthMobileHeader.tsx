import { Link } from 'react-router-dom';
import Logo from './Logo';

// Signup and sign-in on phones: the logo, three of the AI pictures matches
// come with, and what you get. (Desktop has the side panel instead.)
export default function AuthMobileHeader({ line }: { line: string }) {
  return (
    <div className="relative mb-7 lg:hidden">
      <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-[#2563EB]/12 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -left-20 top-10 h-48 w-48 rounded-full bg-[#FACC15]/15 blur-3xl" />
      <Link to="/" className="relative inline-flex"><Logo size="md" /></Link>
      <div className="relative mt-6 flex items-center gap-3">
        <span className="flex -space-x-3">
          {['/landing-v2/java.webp', '/landing-v2/data.webp', '/landing-v2/cloud.webp'].map((src) => (
            <img key={src} src={src} alt="" className="h-11 w-11 rounded-full object-cover object-[50%_18%] ring-[3px] ring-white" />
          ))}
        </span>
        <span className="text-[13px] font-semibold leading-snug text-gray-600">{line}</span>
      </div>
    </div>
  );
}
