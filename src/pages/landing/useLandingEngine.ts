import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { composeStoryData, fetchMarketSnapshot } from '../../lib/marketSnapshot';
import type { StoryData } from '../../lib/marketSnapshot';
import type { EngineOptions, PageEngine } from './engine';

type Start = (root: HTMLElement, data: StoryData, opts: EngineOptions) => PageEngine;

/**
 * Runs a marketing page's animation engine on its root element for as long as
 * the page is mounted, and stops everything it started on unmount. When the
 * page rendered from the bundled snapshot, the live one is fetched and its
 * numbers and date are swapped in place (no re-render, so no animation
 * restarts); the next visit renders from the cached live snapshot directly.
 */
export function useLandingEngine(start: Start, data: StoryData) {
  const rootRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const navRef = useRef(navigate);

  useEffect(() => {
    navRef.current = navigate;
  }, [navigate]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const engine = start(root, data, {
      footer: footRef.current,
      navigate: (to) => navRef.current(to),
    });
    let alive = true;
    if (!data.live) {
      void fetchMarketSnapshot().then((snap) => {
        if (alive && snap) engine.update(composeStoryData(snap));
      });
    }
    return () => {
      alive = false;
      engine.dispose();
    };
  }, [start, data]);

  return { rootRef, footRef };
}
