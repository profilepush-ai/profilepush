import { useEffect, useMemo, useRef, useState } from 'react';
import { MapPin, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

type Suggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

type PlaceDetails = {
  placeId: string;
  formatted: string;
  city: string;
  state: string;
  stateCode: string;
  country: string;
  countryCode: string;
  lat: number | null;
  lng: number | null;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSelectPlace?: (place: PlaceDetails) => void;
  scope?: 'any' | 'city' | 'state' | 'country';
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  disabled?: boolean;
};

function makeSessionToken() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function LocationAutosuggestInput({
  value,
  onChange,
  onSelectPlace,
  scope = 'any',
  placeholder = 'City, State, Country',
  className = '',
  inputClassName = '',
  disabled = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const sessionTokenRef = useRef<string>(makeSessionToken());

  const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string) || '';
  const supabaseAnon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || '';

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    const q = value.trim();
    if (!q || q.length < 2 || !supabaseUrl) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const accessToken = session?.access_token ?? '';
        if (!accessToken) {
          if (!cancelled) setSuggestions([]);
          return;
        }

        const res = await fetch(`${supabaseUrl}/functions/v1/google-places`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(supabaseAnon ? { Apikey: supabaseAnon } : {}),
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ mode: 'autocomplete', input: q, sessionToken: sessionTokenRef.current, scope }),
        });
        const data = await res.json();
        if (!cancelled && res.ok) {
          setSuggestions(Array.isArray(data?.suggestions) ? data.suggestions : []);
          setOpen(true);
          setActiveIndex(-1);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, supabaseUrl, supabaseAnon, scope]);

  const hasSuggestions = useMemo(() => suggestions.length > 0, [suggestions]);

  async function pickSuggestion(s: Suggestion) {
    onChange(s.text || `${s.mainText}${s.secondaryText ? `, ${s.secondaryText}` : ''}`);
    setOpen(false);
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token ?? '';
      if (!accessToken) return;

      const res = await fetch(`${supabaseUrl}/functions/v1/google-places`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(supabaseAnon ? { Apikey: supabaseAnon } : {}),
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ mode: 'details', placeId: s.placeId }),
      });
      const data = await res.json();
      if (res.ok && data?.place) {
        const place = data.place as PlaceDetails;
        onChange(place.formatted || s.text);
        onSelectPlace?.(place);
        sessionTokenRef.current = makeSessionToken();
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <MapPin size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
      <input
        type="text"
        value={value}
        onFocus={() => {
          if (suggestions.length > 0) setOpen(true);
        }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!open || !hasSuggestions) return;
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveIndex((prev) => (prev + 1) % suggestions.length);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
          } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            void pickSuggestion(suggestions[activeIndex]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full pl-6 pr-7 h-[30px] text-[12px] border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 placeholder:text-gray-300 bg-white ${inputClassName}`}
      />
      {loading && <Loader2 size={12} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-gray-400" />}

      {open && hasSuggestions && (
        <div className="absolute z-40 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-56 overflow-auto">
          {suggestions.map((s, i) => {
            const active = i === activeIndex;
            return (
              <button
                type="button"
                key={`${s.placeId}-${i}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pickSuggestion(s)}
                className={`w-full text-left px-2.5 py-2 border-b border-gray-100 last:border-b-0 ${active ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
              >
                <div className="text-[12px] font-medium text-gray-800 truncate">{s.mainText || s.text}</div>
                {s.secondaryText && <div className="text-[11px] text-gray-500 truncate">{s.secondaryText}</div>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
