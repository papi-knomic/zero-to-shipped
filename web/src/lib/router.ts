import { useEffect, useState } from 'react';

// Three routes don't justify a router dependency. The landing page (/) is static HTML;
// the host rewrites /app and /documents/<id> to app.html, where this takes over.

export type Route = { name: 'list' } | { name: 'document'; id: string };

export const APP_HOME = '/app';

function parse(pathname: string): Route {
  const match = /^\/documents\/([^/]+)\/?$/.exec(pathname);
  return match ? { name: 'document', id: decodeURIComponent(match[1]!) } : { name: 'list' };
}

export function navigate(path: string): void {
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
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
