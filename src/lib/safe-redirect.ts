/**
 * Where to go after signing in: only a path on this site. "/\evil.example" or "/\t/evil.example"
 * look like paths but the URL parser reads them as another host, so the check resolves the URL
 * and compares origins instead of looking at the first characters. A path that resolves to
 * "//evil.example" ("/.//evil.example", "/a/..//evil.example") is refused too: navigating to it
 * leaves the site.
 */
export function safeNext(next: string | null | undefined, origin: string): string {
  if (!next) return "/";
  try {
    const u = new URL(next, origin);
    if (u.origin !== new URL(origin).origin || /^[/\\]{2}/.test(u.pathname)) return "/";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "/";
  }
}
