import { useState, useEffect, useRef } from 'react';
import { Upload, ImagePlus } from 'lucide-react';
import LogoSpinner from './LogoSpinner';
import { supabase } from '../lib/supabase';

// Admin-uploadable feature screenshot/video panel, shared across every
// marketing landing page (main + persona pages) so a video uploaded once
// against a given featureKey shows up everywhere that key is referenced —
// backed by the `landing-assets` storage bucket and `landing_screenshots`
// table, editable only by poornapotluri27@gmail.com.
export default function GifSlot({
  featureKey,
  imageUrl,
  mobileImageUrl,
  canEdit,
  onUploaded,
  accent,
  topGlow,
}: {
  featureKey: string;
  imageUrl: string | null;
  mobileImageUrl?: string | null;
  canEdit: boolean;
  onUploaded: (key: string, url: string) => void;
  accent: string;
  topGlow: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const isVideo = !!imageUrl && /\.(webm|mp4|mov)(\?|$)/i.test(imageUrl);

  // A second asset per feature, stored as `{key}-mobile.*`, shown only on
  // phones. Desktop capture is a wide browser window; on a 390px screen it
  // scales down to an unreadable strip, which is what a landscape video does
  // here today. When no mobile variant has been uploaded the desktop one is
  // used, so nothing breaks on a feature that only has the one asset.
  const mobileUrl = mobileImageUrl ?? null;
  const isMobileVideo = !!mobileUrl && /\.(webm|mp4|mov)(\?|$)/i.test(mobileUrl);

  useEffect(() => {
    const vid = videoRef.current;
    if (vid && imageUrl) {
      vid.setAttribute('webkit-playsinline', '');
      vid.play().catch(() => {});
    }
  }, [imageUrl]);

  // Images were rejected outright before, so a screenshot could not be put on
  // these pages at all — only a video.
  const EXT_BY_TYPE: Record<string, string> = {
    'video/webm': 'webm',
    'video/mp4': 'mp4',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  };

  async function handleFile(file: File, variant: 'desktop' | 'mobile' = 'desktop') {
    const ext = EXT_BY_TYPE[file.type];
    if (!ext) return;
    setUploading(true);
    try {
      const path = `features/${featureKey}${variant === 'mobile' ? '-mobile' : ''}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from('landing-assets')
        .upload(path, file, { upsert: true, contentType: file.type });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from('landing-assets').getPublicUrl(path);
      // upsert:true overwrites the same storage path, so re-uploading with the
      // same file extension produces a byte-identical URL to the old one —
      // browsers and the Supabase CDN then keep serving the stale cached
      // video at that URL indefinitely. A cache-busting query param forces
      // every upload to be a genuinely new URL nobody has cached yet.
      const publicUrl = `${urlData.publicUrl}?v=${Date.now()}`;

      await supabase
        .from('landing_screenshots')
        .upsert(
          variant === 'mobile'
            ? { feature_key: `${featureKey}-mobile`, image_url: publicUrl, updated_at: new Date().toISOString() }
            : { feature_key: featureKey, image_url: publicUrl, updated_at: new Date().toISOString() },
          { onConflict: 'feature_key' },
        );

      onUploaded(variant === 'mobile' ? `${featureKey}-mobile` : featureKey, publicUrl);
    } catch (err) {
      console.error('Upload failed:', err);
    }
    setUploading(false);
  }

  return (
    <div className="relative w-full">
      {/* The frame itself changes shape: a phone-shaped box on mobile so a
          portrait screenshot fills it, and the wide browser shape from sm up.
          A 1866x968 frame on a 390px screen is 200px tall, which is where the
          app UI in these assets became unreadable. */}
      <div className={`relative w-full p-px overflow-hidden shadow-2xl shadow-gray-300/40 gradient-border-frame ${mobileUrl ? 'aspect-[9/16] sm:aspect-[1866/968]' : 'aspect-[1866/968]'}`}>
      <div
        className="relative w-full h-full overflow-hidden bg-white group"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* Content area */}
      <div className={`absolute inset-0 bg-gradient-to-br ${accent}`}>
        {mobileUrl && (
          // Phones get their own asset and never download the desktop one.
          <div className="sm:hidden w-full h-full">
            {isMobileVideo ? (
              <video src={mobileUrl} autoPlay loop muted playsInline preload="metadata" disablePictureInPicture disableRemotePlayback className="w-full h-full object-contain" />
            ) : (
              <img src={mobileUrl} alt="Feature preview on mobile" loading="lazy" decoding="async" className="w-full h-full object-contain" />
            )}
          </div>
        )}
        <div className={mobileUrl ? 'hidden sm:block w-full h-full' : 'w-full h-full'}>
        {imageUrl ? (
          isVideo ? (
          <video
            ref={videoRef}
            src={imageUrl}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            disablePictureInPicture
            disableRemotePlayback
            className="w-full h-full object-contain"
          />
          ) : (
            <img
              src={imageUrl}
              alt="Feature preview"
              loading="lazy"
              decoding="async"
              className="w-full h-full object-contain"
            />
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 border border-gray-200 flex items-center justify-center">
              <ImagePlus size={24} className="text-gray-300" />
            </div>
            <p className="text-gray-300 text-xs font-medium">Screenshot or video will appear here</p>
          </div>
        )}
        </div>
      </div>

      {/* Upload overlay */}
      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept=".webm,.mp4,.png,.jpg,.jpeg,.webp,video/webm,video/mp4,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f, 'desktop'); e.target.value = ''; }}
          />
          <input
            ref={mobileInputRef}
            type="file"
            accept=".webm,.mp4,.png,.jpg,.jpeg,.webp,video/webm,video/mp4,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f, 'mobile'); e.target.value = ''; }}
          />
          <div
            className={`absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-white/75 backdrop-blur-sm transition-opacity duration-200 ${hovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          >
            {uploading ? (
              <LogoSpinner size={32} />
            ) : (
              <>
                <Upload size={22} className="text-blue-600" />
                <div className="flex gap-2">
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    {imageUrl ? 'Replace desktop' : 'Upload desktop'}
                  </button>
                  <button
                    onClick={() => mobileInputRef.current?.click()}
                    className="rounded-lg border border-blue-600 px-3 py-1.5 text-xs font-semibold text-blue-700"
                  >
                    {mobileUrl ? 'Replace mobile' : 'Upload mobile'}
                  </button>
                </div>
                <span className="text-[11px] text-gray-500">PNG, JPG, WebP, MP4 or WebM</span>
              </>
            )}
          </div>
        </>
      )}
      </div>
      </div>
    </div>
  );
}
