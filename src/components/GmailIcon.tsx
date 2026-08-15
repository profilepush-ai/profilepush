export default function GmailIcon({ size = 14, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#4285F4" d="M45,16.2l-5,2.75l-5,4.75L35,40h7c1.657,0,3-1.343,3-3V16.2z" />
      <path fill="#34A853" d="M3,16.2l3.614,1.71L13,23.7V40H6c-1.657,0-3-1.343-3-3V16.2z" />
      <path fill="#FBBC04" d="M35,11.2l-11,8.25l-11-8.25L12,17l11,8.25L34,17L35,11.2z" />
      <path fill="#EA4335" d="M3,12.298V16.2l10,7.5V11.2L9.945,8.909c-0.678-0.508-1.596-0.541-2.313-0.093 C6.109,9.702,3,11.634,3,12.298z" />
      <path fill="#C5221F" d="M45,12.298V16.2l-10,7.5V11.2l3.055-2.291c0.678-0.508,1.596-0.541,2.313-0.093 C41.891,9.702,45,11.634,45,12.298z" />
    </svg>
  );
}
