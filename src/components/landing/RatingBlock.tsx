import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import { supabase } from '../../lib/supabase';

// The landing page's rating: the live average from users' own ratings and up
// to three comments their authors agreed to show, with matching
// SoftwareApplication aggregateRating structured data on the same @id as the
// static block in index.html. Google only allows rating markup that is
// visible on the page and comes from real users, so nothing renders, and no
// markup is added, until there are at least 10 ratings.

type PublicRating = {
  count: number;
  average?: number;
  testimonials?: Array<{ rating: number; comment: string; name: string | null; company: string | null; persona: string | null }>;
};

const SCRIPT_ID = 'profilepush-rating-jsonld';

export default function RatingBlock() {
  const [rating, setRating] = useState<PublicRating | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.rpc('get_public_rating' as never).then(({ data }) => {
      if (!cancelled && data) setRating(data as unknown as PublicRating);
    });
    return () => { cancelled = true; };
  }, []);

  const live = Boolean(rating && rating.count >= 10 && rating.average);

  useEffect(() => {
    if (!live || !rating?.average) return;
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.id = SCRIPT_ID;
    script.text = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      '@id': 'https://profilepush.ai/#software',
      name: 'ProfilePush',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web, Android',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: String(rating.average),
        ratingCount: String(rating.count),
        bestRating: '5',
        worstRating: '1',
      },
    });
    document.getElementById(SCRIPT_ID)?.remove();
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, [live, rating]);

  if (!live || !rating?.average) return null;
  const rounded = Math.round(rating.average);

  return (
    <section aria-label="What users say" className="border-y border-gray-100 bg-white px-6 py-16">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-1 text-center">
          <div className="flex items-center gap-2">
            <span className="inline-flex">
              {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={22} className={i <= rounded ? 'fill-amber-400 text-amber-400' : 'text-gray-200'} />)}
            </span>
            <span className="text-2xl font-extrabold text-gray-900">{rating.average.toFixed(1)}</span>
          </div>
          <p className="text-sm text-gray-500">from {rating.count.toLocaleString('en-US')} vendors and bench sales recruiters using ProfilePush</p>
        </div>
        {rating.testimonials && rating.testimonials.length > 0 && (
          <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
            {rating.testimonials.map((t, i) => (
              <figure key={i} className="flex flex-col gap-3 rounded-2xl border border-gray-200 bg-white p-5">
                <span className="inline-flex">
                  {[1, 2, 3, 4, 5].map((s) => <Star key={s} size={13} className={s <= t.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-200'} />)}
                </span>
                <blockquote className="text-[14px] leading-relaxed text-gray-700">&ldquo;{t.comment}&rdquo;</blockquote>
                <figcaption className="mt-auto text-[12px] text-gray-500">
                  {[t.name, t.company].filter(Boolean).join(', ') || 'ProfilePush user'}
                  {t.persona ? ` · ${t.persona === 'bench_sales' ? 'Bench sales' : 'Vendor'}` : ''}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
