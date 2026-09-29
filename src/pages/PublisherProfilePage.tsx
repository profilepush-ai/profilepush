import { useParams } from 'react-router-dom';
import PulsePage from './PulsePage';

// /p/:slug — a publisher's profile as its own page. The feed page draws it in
// profile mode so the posts are the feed's own cards, with the same actions
// and pop-ups. Keyed by slug so moving between profiles starts fresh.
export default function PublisherProfilePage() {
  const { slug = '' } = useParams<{ slug: string }>();
  return <PulsePage key={slug} feedKind="feed" publisherSlug={slug} />;
}
