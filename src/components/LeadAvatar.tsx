import { useState } from 'react';

// Palette picked for readable white-text contrast at this size, cycled by a
// hash of the name so the same person always lands on the same color.
const INITIALS_PALETTE = [
  '#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#D97706',
  '#65A30D', '#059669', '#0891B2', '#4F46E5', '#9333EA',
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function LeadAvatar({ avatarUrl, name, size = 20 }: { avatarUrl: string | null; name: string; size?: number }) {
  // HarvestAPI's avatar URLs are signed and expire, so a stored URL can 404
  // well after the lead was scraped — fall back to initials instead of a
  // broken image icon.
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = Boolean(avatarUrl) && !imageFailed;
  const color = INITIALS_PALETTE[hashString(name || '?') % INITIALS_PALETTE.length];

  if (showImage) {
    return (
      <img
        src={avatarUrl!}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
        onError={() => setImageFailed(true)}
      />
    );
  }

  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, backgroundColor: color, fontSize: Math.max(8, size * 0.42) }}
    >
      {getInitials(name)}
    </span>
  );
}
