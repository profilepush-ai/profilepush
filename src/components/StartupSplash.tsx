import BrandLoader from './brand/BrandLoader';

interface StartupSplashProps {
  hide: boolean;
}

// The app's opening screen. It starts on the same white as the native splash,
// then the brand loader plays once: the dots match, the chevron pushes the
// score line to 100%, and it fades into the app.
export default function StartupSplash({ hide }: StartupSplashProps) {
  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-white transition-opacity duration-500 ${hide ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      aria-hidden={hide}
    >
      <div className="absolute inset-0 animate-[ppFadeIn_.8s_ease-out_both] bg-[radial-gradient(circle_at_20%_18%,rgba(37,99,235,0.10),transparent_55%),radial-gradient(circle_at_82%_84%,rgba(249,115,22,0.10),transparent_50%),radial-gradient(circle_at_70%_10%,rgba(250,204,21,0.08),transparent_40%)]" />
      <div className="relative flex flex-col items-center gap-7 px-6 text-center">
        <b className="animate-[ppFadeUp_.5s_ease-out_both] text-[34px] font-extrabold tracking-[-0.03em] text-[#0B1A3A]">ProfilePush</b>
        <span className="pp-ld-quick"><BrandLoader width={200} /></span>
        <p className="max-w-[26ch] animate-[ppFadeUp_.5s_ease-out_.3s_both] text-[13.5px] font-semibold leading-snug text-gray-500">AI Copilot for job hunting, job posting and bench sales</p>
      </div>
    </div>
  );
}
