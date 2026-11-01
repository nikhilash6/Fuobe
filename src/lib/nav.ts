/** Sidebar helpers (pure, so they're testable): active state, and the remembered group and collapse state. */

/** Group labels the user collapsed, in localStorage. */
export const NAV_CLOSED_KEY = "fuobe:nav-closed";
/**
 * Folded until the user opens them (nothing remembered yet). Studios starts open, so a first visit shows
 * that the studios exist; Engine (models, workflows, settings) starts folded. ⌘K reaches folded rows too.
 */
export const DEFAULT_NAV_CLOSED: readonly string[] = ["engine"];
/** Written by the shadcn SidebarProvider ("true" / "false"). */
export const SIDEBAR_COOKIE = "sidebar_state";

export const groupId = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** "New creation" (the sidebar and ⌘K): Home with a fresh composer, so it does more than the Home row. Home drops the flag. */
export const NEW_CREATION_PARAM = "new";
export const NEW_CREATION_HREF = `/?${NEW_CREATION_PARAM}=1`;

/**
 * How deep the sidebar's fades are, in px: as much as is hidden past each edge, up to 24 at the top
 * and 40 at the bottom. So a few pixels of padding past the edge never dim the last row, and a row
 * the edge cuts through is always faded, never cut sharp.
 */
export function scrollFades(el: { scrollTop: number; clientHeight: number; scrollHeight: number }): { above: number; below: number } {
  const depth = (hidden: number, max: number) => (hidden < 1 ? 0 : Math.round(Math.min(hidden, max)));
  return { above: depth(el.scrollTop, 24), below: depth(el.scrollHeight - el.clientHeight - el.scrollTop, 40) };
}

function pathMatches(path: string, pathname: string) {
  return path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`);
}

function queryMatches(query: string, search: URLSearchParams) {
  return [...new URLSearchParams(query)].every(([k, v]) => search.get(k) === v);
}

/**
 * Whether a nav link is the current page. A link with a query (`/library?tab=favorites`) is active
 * when the path and every one of its params match; a plain link is active on its path (and below it)
 * unless a sibling matches better: a query link to the same path, or a link to a page below it
 * (Settings yields to About & licences on /settings/about).
 */
export function navActive(href: string, pathname: string, search: URLSearchParams, siblings: string[] = []): boolean {
  if (!pathname) return false;
  const [path, query] = href.split("?");
  if (!pathMatches(path, pathname)) return false;
  if (query) return queryMatches(query, search);
  return !siblings.some((s) => {
    const [p, q] = s.split("?");
    if (p !== path && p.startsWith(`${path === "/" ? "" : path}/`)) return pathMatches(p, pathname);
    return !!q && p === path && pathMatches(p, pathname) && queryMatches(q, search);
  });
}

/**
 * Read the collapsed groups (ids) from storage; tolerant of anything unexpected. Nothing stored (or
 * nothing readable) means the defaults; a stored list, even an empty one, is the user's own choice.
 */
export function parseClosed(raw: string | null | undefined): string[] {
  try {
    const v = raw == null ? null : JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [...DEFAULT_NAV_CLOSED];
  } catch {
    return [...DEFAULT_NAV_CLOSED];
  }
}

export function sidebarOpenFromCookie(cookie: string): boolean {
  return !new RegExp(`(?:^|;\\s*)${SIDEBAR_COOKIE}=false(?:;|$)`).test(cookie);
}

/** The cookie that remembers the expanded/collapsed choice (as the shadcn SidebarProvider writes it). */
export function sidebarCookie(open: boolean): string {
  return `${SIDEBAR_COOKIE}=${open}; path=/; max-age=${60 * 60 * 24 * 7}`;
}

/**
 * Full-screen studios: a project open in Cinema, Canvas or Layers, and Assist (with its own rail of
 * chats). They have a sidebar of their own, so the app sidebar folds to its icon rail while one is
 * open, without touching the remembered choice, and comes back on the way out.
 */
const FULL_SCREEN = /^\/(?:(?:cinema|canvas|layers)\/[^/]+\/?|assist(?:\/.*)?)$/;

/**
 * Which full-screen studio a path belongs to (null on any other page): the project's own path, or
 * "/assist" for every Assist page (its chats, projects, skills and memory are one workspace). The
 * sidebar opened by hand stays open while you move inside one studio, and folds again in the next.
 */
export function fullScreenStudio(pathname: string): string | null {
  if (!FULL_SCREEN.test(pathname)) return null;
  return /^\/assist(?:\/|$)/.test(pathname) ? "/assist" : pathname.replace(/\/$/, "");
}

/**
 * Inline script that applies the remembered state to the server-rendered sidebar before the first
 * paint: the collapsed rail (the cookie, or a full-screen studio) and the folded groups
 * (localStorage). The server renders the default folds (DEFAULT_NAV_CLOSED); a remembered list
 * opens or folds every foldable group to match. React's first client render reads the same values,
 * so hydration matches the patched DOM.
 */
export const SIDEBAR_STATE_SCRIPT = `(function(){try{var d=document;if(/(?:^|;\\s*)${SIDEBAR_COOKIE}=false(?:;|$)/.test(d.cookie)||${FULL_SCREEN}.test(location.pathname)){var s=d.querySelector('[data-slot="sidebar"]');if(s){s.setAttribute("data-state","collapsed");s.setAttribute("data-collapsible","icon")}}var r=localStorage.getItem("${NAV_CLOSED_KEY}");if(r===null)return;var c=JSON.parse(r);if(!Array.isArray(c))return;d.querySelectorAll("[data-nav-group]").forEach(function(e){var b=e.querySelector("[data-nav-toggle]");if(!b)return;var o=c.indexOf(e.getAttribute("data-nav-group"))<0?"true":"false";e.setAttribute("data-open",o);b.setAttribute("aria-expanded",o)})}catch(e){}})()`;
