import { useEffect, useState } from 'react';

// A handful of routes don't justify a router dependency. The landing page (/) is static HTML;
// the host rewrites every other extension-less path to app.html, where this takes over.

export type Route =
  | { name: 'list' }
  | { name: 'document'; id: string }
  | { name: 'signin' }
  | { name: 'signup' }
  | { name: 'forgot' }
  | { name: 'demo' };

export type AuthRouteName = 'signin' | 'signup' | 'forgot';

export const APP_HOME = '/app';

const STATIC_ROUTES: Record<string, Route> = {
  '/signin': { name: 'signin' },
  '/signup': { name: 'signup' },
  '/forgot-password': { name: 'forgot' },
  '/demo': { name: 'demo' },
};

function parse(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  const match = /^\/documents\/([^/]+)$/.exec(path);
  if (match) return { name: 'document', id: decodeURIComponent(match[1]!) };
  return STATIC_ROUTES[path] ?? { name: 'list' };
}

export function isAuthRoute(route: Route): route is { name: AuthRouteName } {
  return route.name === 'signin' || route.name === 'signup' || route.name === 'forgot';
}

export function navigate(path: string, { replace = false } = {}): void {
  if (replace) window.history.replaceState(null, '', path);
  else window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

/** Only same-site paths are followed after sign-in, never another origin. */
export function safeNext(value: string | null): string {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : APP_HOME;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.pathname));
  useEffect(() => {
    const onPop = () => setRoute(parse(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return route;
}

/** Plain left-clicks navigate in-app; modified clicks keep default browser behaviour. */
export function linkHandler(path: string) {
  return (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(path);
  };
}
