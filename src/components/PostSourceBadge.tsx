import type { PostSource } from '../lib/post-source';

// Marks a post published on ProfilePush itself: the logo icon alone, no
// wording. On feed cards it sits in the corner to the left of the job /
// hotlist icon (LeadKindPill's banner); elsewhere it stands inline.
export default function PostSourceBadge({ source, size = 12 }: { source: PostSource; size?: number }) {
  if (source !== 'user_post') return null;
  return (
    <img
      src="/favicon.svg"
      width={size}
      height={size}
      alt="Posted on ProfilePush"
      title="Posted on ProfilePush"
      className="inline-block shrink-0 rounded-[3px]"
    />
  );
}
