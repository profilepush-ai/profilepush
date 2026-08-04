import { useEffect } from 'react';

interface SEOProps {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
  jsonLd?: object | object[];
}

const BASE_URL = 'https://profilepush.ai';

function setMeta(name: string, content: string, attr: 'name' | 'property' = 'name') {
  let el = document.querySelector(`meta[${attr}="${CSS.escape(name)}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function setCanonical(url: string) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  (el as HTMLLinkElement).href = url;
}

export default function SEO({ title, description, canonical, ogImage, jsonLd }: SEOProps) {
  useEffect(() => {
    const fullTitle = title.includes('ProfilePush') ? title : `${title} | ProfilePush`;
    document.title = fullTitle;

    const canonicalUrl = canonical ?? (BASE_URL + window.location.pathname);
    const img = ogImage ?? `${BASE_URL}/og-image.png`;

    setMeta('description', description);
    setMeta('og:type', 'website', 'property');
    setMeta('og:title', fullTitle, 'property');
    setMeta('og:description', description, 'property');
    setMeta('og:url', canonicalUrl, 'property');
    setMeta('og:image', img, 'property');
    setMeta('twitter:card', 'summary_large_image', 'name');
    setMeta('twitter:title', fullTitle, 'name');
    setMeta('twitter:description', description, 'name');
    setCanonical(canonicalUrl);

    if (jsonLd) {
      document.getElementById('page-jsonld')?.remove();
      const script = document.createElement('script');
      script.id = 'page-jsonld';
      script.type = 'application/ld+json';
      script.text = JSON.stringify(jsonLd);
      document.head.appendChild(script);
    }

    return () => { document.getElementById('page-jsonld')?.remove(); };
  }, [title, description, canonical, ogImage, jsonLd]);

  return null;
}
