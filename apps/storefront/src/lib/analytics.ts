import type { AnalyticsEvent } from '@femia/contracts';

type Name = AnalyticsEvent['name'];
let queue: AnalyticsEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function sessionId() {
  try {
    let id = sessionStorage.getItem('femia.sid');
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('femia.sid', id); }
    return id;
  } catch { return 'anon-' + Math.random().toString(36).slice(2, 12); }
}

function flush() {
  if (!queue.length) return;
  const body = JSON.stringify({ events: queue.splice(0, 20) });
  const blob = new Blob([body], { type: 'application/json' });
  if (!navigator.sendBeacon?.('/api/events', blob)) fetch('/api/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {});
}

/** Recorded from launch so 1.1's funnel dashboard has history. */
export function track(name: Name, props: Omit<AnalyticsEvent, 'name' | 'sessionId'> = {}) {
  if (typeof window === 'undefined') return;
  queue.push({ name, sessionId: sessionId(), path: location.pathname.slice(0, 200), ...props });
  clearTimeout(timer);
  timer = setTimeout(flush, 1500);
  if (queue.length >= 20) flush();
}

if (typeof window !== 'undefined') addEventListener('pagehide', flush);
