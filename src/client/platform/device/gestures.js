import { useEffect, useRef, useState } from 'react';

// Touch gestures (part 03.06, FR-05): swipe a list row to reveal its actions, pull a list down to refresh it.

/** What a horizontal drag amounts to: 'left', 'right' or null, ignoring drags that are mostly vertical (the person is scrolling). */
export function swipeDirection(dx, dy, { threshold = 56 } = {}) {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'left' : 'right';
}

/** Whether a downward pull from the top of the page is long enough to refresh, and how far to draw the indicator. */
export function pullState(dy, { threshold = 72, atTop = true } = {}) {
  if (!atTop || dy <= 0) return { pulling: false, ready: false, offset: 0 };
  return { pulling: true, ready: dy >= threshold, offset: Math.min(dy * 0.5, threshold) };
}

/**
 * Handlers that call `onSwipe('left' | 'right')` for a horizontal swipe on an element. Spread them on the element.
 * `touch-action: pan-y` on the element lets the page keep scrolling vertically.
 */
export function useSwipe(onSwipe, options) {
  const start = useRef(null);
  return {
    onTouchStart: (e) => { const t = e.touches[0]; start.current = { x: t.clientX, y: t.clientY }; },
    onTouchEnd: (e) => {
      if (!start.current) return;
      const t = e.changedTouches[0];
      const dir = swipeDirection(t.clientX - start.current.x, t.clientY - start.current.y, options);
      start.current = null;
      if (dir) onSwipe(dir);
    },
    onTouchCancel: () => { start.current = null; },
  };
}

/**
 * Pull to refresh for a page: when the page is scrolled to the top and the person pulls down, `onRefresh()` runs (it may return a promise).
 * Returns { offset, ready, refreshing } for the indicator. Works with touch only, so a mouse never triggers it.
 */
export function usePullToRefresh(onRefresh, { enabled = true } = {}) {
  const [view, setView] = useState({ offset: 0, ready: false, refreshing: false });
  const startY = useRef(null);
  const ready = useRef(false); // whether the pull is long enough, kept apart from the drawn state so letting go can read it at once
  const busy = useRef(false);
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    if (!enabled) return undefined;
    const atTop = () => (document.scrollingElement?.scrollTop ?? 0) <= 0;
    const down = (e) => { startY.current = atTop() ? e.touches[0].clientY : null; };
    const move = (e) => {
      if (startY.current === null) return;
      const s = pullState(e.touches[0].clientY - startY.current, { atTop: atTop() });
      ready.current = s.ready;
      if (!busy.current) setView({ offset: s.offset, ready: s.ready, refreshing: false });
    };
    const up = async () => {
      if (startY.current === null) return;
      startY.current = null;
      const go = ready.current && !busy.current;
      ready.current = false;
      if (!go) { setView({ offset: 0, ready: false, refreshing: false }); return; }
      busy.current = true;
      setView({ offset: 40, ready: false, refreshing: true });
      try { await refresh.current(); } finally { busy.current = false; setView({ offset: 0, ready: false, refreshing: false }); }
    };
    window.addEventListener('touchstart', down, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', up);
    window.addEventListener('touchcancel', up);
    return () => { window.removeEventListener('touchstart', down); window.removeEventListener('touchmove', move); window.removeEventListener('touchend', up); window.removeEventListener('touchcancel', up); };
  }, [enabled]);
  return view;
}
