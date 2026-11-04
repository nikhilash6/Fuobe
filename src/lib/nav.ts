/** App frame helpers (pure, so they're testable): which link is the open page, full-screen studios, the pre-paint script. */

export const groupId = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** "New creation" (the top bar, the phone's Create sheet): Home with a fresh composer, so it does more than the Home row. Home drops the flag. */
export const NEW_CREATION_PARAM = "new";
export const NEW_CREATION_HREF = `/?${NEW_CREATION_PARAM}=1`;

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
 * (a link to /settings yields to one to a page below it).
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
 * Full-screen studios: a project open in Cinema, Canvas or Layers, Assist (with its own rail of
 * chats), and Live edit (the picture fills the page). They take the whole screen: on a phone the tab bar steps aside and
 * the header button opens the menu instead.
 */
const FULL_SCREEN = /^\/(?:(?:cinema|canvas|layers)\/[^/]+\/?|assist(?:\/.*)?|live-edit\/?)$/;

/**
 * Which full-screen studio a path belongs to (null on any other page): the project's own path, or
 * "/assist" for every Assist page (its chats, projects, skills and memory are one workspace).
 */
export function fullScreenStudio(pathname: string): string | null {
  if (!FULL_SCREEN.test(pathname)) return null;
  return /^\/assist(?:\/|$)/.test(pathname) ? "/assist" : pathname.replace(/\/$/, "");
}

/** The bar's pills whose room is kept from the first paint (use-had-items.ts names, remembered by the bar). */
export const CHROME_HAD_PILLS = ["balance", "computer", "placeholders"] as const;

/**
 * Inline script that runs while the HTML is parsed, so the app frame has its final shape on the first paint (the
 * server renders one shell for everyone): `data-fullscreen-studio` on a full-screen studio (the phone's tab bar
 * gives it the whole screen), `data-viewer` as this browser last knew it ("fuobe:viewer", as api.ts's VIEWER_KEY:
 * the bar's right side keeps a guest's or an account's room), and `data-had-<pill>` for the bar's pills it showed
 * last (use-had-items.ts). Every read is guarded: blocked storage leaves the defaults.
 */
export const CHROME_STATE_SCRIPT = `(function(){var d=document.documentElement;try{if(${FULL_SCREEN}.test(location.pathname))d.setAttribute("data-fullscreen-studio","")}catch(e){}try{var v=localStorage.getItem("fuobe:viewer");if(v==="guest"||v==="account"||v==="owner")d.setAttribute("data-viewer",v)}catch(e){}try{${JSON.stringify(CHROME_HAD_PILLS)}.forEach(function(n){var x=localStorage.getItem("fuobe:had:"+n);if(x&&/^[1-9][0-9]?$/.test(x))d.setAttribute("data-had-"+n,x)})}catch(e){}})()`;
