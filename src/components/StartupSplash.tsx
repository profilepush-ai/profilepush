import Logo from './Logo';
import LogoSpinner from './LogoSpinner';

interface StartupSplashProps {
  hide: boolean;
}

export default function StartupSplash({ hide }: StartupSplashProps) {
  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-white transition-opacity duration-500 ${hide ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      aria-hidden={hide}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_22%_20%,rgba(37,99,235,0.08),transparent_56%),radial-gradient(circle_at_80%_82%,rgba(249,115,22,0.1),transparent_50%)]" />
      <div className="relative flex flex-col items-center gap-4 px-6 text-center">
        <div className="animate-splash-logo-rise rounded-2xl border border-blue-100/70 bg-white/90 px-5 py-3 shadow-[0_12px_35px_rgba(37,99,235,0.12)] backdrop-blur">
          <Logo size="lg" />
        </div>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-gray-500">
          <LogoSpinner size={16} />
        </div>
      </div>
    </div>
  );
}