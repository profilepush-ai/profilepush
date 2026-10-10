import { useEffect, useState } from 'react';

// The colors of a picture's top, middle and bottom, for a smooth gradient
// behind it (a CSS blur shows blotches on phones and costs battery).
// Read from an 8×12 copy of the picture; remembered per picture.
const cache = new Map<string, string[]>();

export function usePictureColors(url: string | null): string[] | null {
  const [colors, setColors] = useState<string[] | null>(() => (url ? cache.get(url) ?? null : null));
  useEffect(() => {
    if (!url) { setColors(null); return undefined; }
    const known = cache.get(url);
    if (known) { setColors(known); return undefined; }
    let alive = true;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 8; canvas.height = 12;
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0, 8, 12);
        const band = (y0: number, y1: number) => {
          const d = ctx.getImageData(0, y0, 8, y1 - y0).data;
          let r = 0, g = 0, b = 0;
          for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
          const n = d.length / 4;
          return `rgb(${Math.round(r / n)} ${Math.round(g / n)} ${Math.round(b / n)})`;
        };
        const out = [band(0, 4), band(4, 8), band(8, 12)];
        cache.set(url, out);
        if (alive) setColors(out);
      } catch {
        // A picture the browser won't let us read: the plain dark background.
      }
    };
    img.src = url;
    return () => { alive = false; };
  }, [url]);
  return colors;
}
