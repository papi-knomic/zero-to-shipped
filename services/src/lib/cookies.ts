/**
 * Session cookies: HttpOnly (page scripts can't read them), Secure, SameSite=Lax, host-only.
 * The site and the API share one origin, so the browser sends them to /api automatically.
 */
export function setCookie(name: string, value: string, opts: { path: string; maxAgeSeconds: number }): string {
  return `${name}=${encodeURIComponent(value)}; Path=${opts.path}; Max-Age=${opts.maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string, path: string): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}
