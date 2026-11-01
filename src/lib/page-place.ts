/**
 * Is this page on the same machine as Fuobe's server, and what does an address typed into Fuobe mean from the
 * server's side? Pure, for the browser and the server alike (no DOM, no `node:` modules).
 *
 * A page at localhost or 127.0.0.1 is "here": the browser and the server share one machine, so 127.0.0.1:8188 is the
 * same ComfyUI to both. A page at a LAN address or a local name is "network": the server is on the person's own network,
 * where its own 127.0.0.1 and the LAN mean something to it. Any other page is "hosted" (fuobe.com): the server is
 * somewhere else, and a loopback or private address typed there would make it call itself or its own network, never
 * the person's computer. The answer steers what the page offers first. It is never a security boundary: the server
 * never trusts it, and it only ever skips a call.
 */

/** Names nobody on the internet can point at a machine: this machine, the LAN, reserved suffixes. */
export const LOCAL_SUFFIXES = [".localhost", ".local", ".lan", ".home.arpa", ".internal", ".localdomain"];

export type PagePlace = "here" | "network" | "hosted";

/** What an address means to a server: this machine, a private network, link-local, a LAN name, the internet, or not an address. */
export type AddressKind = "loopback" | "private" | "link-local" | "local-name" | "public" | "invalid";

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function v4Parts(host: string): number[] | null {
  const m = V4.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((n) => n <= 255) ? parts : null;
}

function v4Kind([a, b]: number[]): Exclude<AddressKind, "local-name" | "invalid"> {
  if (a === 127 || a === 0) return "loopback";
  if (a === 169 && b === 254) return "link-local";
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return "private";
  return "public";
}

/** An IPv6 literal as eight numbers, or null. Takes the forms a URL's hostname has (compressed, an IPv4 tail). */
function v6Hextets(host: string): number[] | null {
  if (!host.includes(":") || !/^[0-9a-f:.]+$/.test(host)) return null;
  let s = host;
  const tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (tail) {
    const p = v4Parts(tail[1]);
    if (!p) return null;
    s = `${s.slice(0, -tail[1].length)}${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const read = (part: string) => (part ? part.split(":") : []);
  const head = read(halves[0]);
  const rest = halves.length === 2 ? read(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const all = [...head, ...Array<string>(fill).fill("0"), ...rest];
  if (all.length !== 8 || all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => parseInt(h, 16));
}

function v6Kind(h: number[]): Exclude<AddressKind, "local-name" | "invalid"> {
  const zeros = (n: number) => h.slice(0, n).every((x) => x === 0);
  // ::1 and :: (this host), and an IPv4 address carried inside (::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d).
  if (zeros(7) && (h[7] === 1 || h[7] === 0)) return "loopback";
  const inner = (zeros(5) && (h[5] === 0xffff || h[5] === 0)) || (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0));
  if (inner) return v4Kind([h[6] >> 8, h[6] & 0xff, h[7] >> 8, h[7] & 0xff]);
  if ((h[0] & 0xffc0) === 0xfe80) return "link-local";
  if ((h[0] & 0xfe00) === 0xfc00) return "private";
  return "public";
}

/** A host as a URL gives it, lower case, without brackets or a trailing dot. */
const bare = (host: string) => host.trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");

/** What a host name or IP literal means to a server. */
export function hostKind(rawHost: string): Exclude<AddressKind, "invalid"> {
  const host = bare(rawHost);
  if (host === "localhost" || host.endsWith(".localhost")) return "loopback";
  const v4 = v4Parts(host);
  if (v4) return v4Kind(v4);
  const v6 = v6Hextets(host);
  if (v6) return v6Kind(v6);
  if (!host.includes(".") || LOCAL_SUFFIXES.some((s) => host.endsWith(s))) return "local-name";
  return "public";
}

/** Where this page is, from its own hostname (window.location.hostname). */
export function pagePlace(hostname: string): PagePlace {
  const k = hostKind(hostname);
  return k === "loopback" ? "here" : k === "public" ? "hosted" : "network";
}

/** An address as typed: "127.0.0.1:8188" and "localhost:8188" count as http:// ones (people leave it off). */
function parsed(raw: string): URL | null {
  const s = raw.trim();
  if (!s) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:\d+)?(\/\S*)?$/i.test(s) ? `http://${s}` : s;
  try {
    const u = new URL(withScheme);
    return (u.protocol === "http:" || u.protocol === "https:") && u.hostname ? u : null;
  } catch {
    return null;
  }
}

/** What a ComfyUI address means to a server. Ports, paths, brackets, a trailing dot and upper case are all fine. */
export function addressKind(url: string): AddressKind {
  const u = parsed(url);
  return u ? hostKind(u.hostname) : "invalid";
}

/** The host of an address, as shown in a sentence ("127.0.0.1", "nas.local", "[::1]"); "" when it isn't one. */
export function addressHost(url: string): string {
  return parsed(url)?.hostname ?? "";
}

/**
 * On a hosted page, an address Fuobe's server must not be asked to call for the person's own ComfyUI: this machine,
 * link-local, and (unless the server allows private addresses: FUOBE_ALLOW_PRIVATE_URLS, a VPN such as Tailscale) a
 * private network or a LAN name.
 */
export const refusedOnHosted = (k: AddressKind, allowPrivate: boolean): boolean =>
  k === "loopback" || k === "link-local" || ((k === "private" || k === "local-name") && !allowPrivate);

/** The one line a refused address gets: what that address means here. */
export function refusedLine(k: AddressKind, host: string): string {
  if (k === "loopback") return `On this website, ${host} is Fuobe's server, not your computer.`;
  return `${host} is on your own network, which Fuobe's server can't reach.`;
}

/** The line the server's own refusal of a name that leads to a private address gets. */
export const resolvesPrivateLine = (host: string) => `${host} leads to a private address, so Fuobe's server won't call it.`;

/** Said when nothing was typed and only the built-in address (this machine's) is there to test. */
export const TYPE_AN_ADDRESS = "Type the address of a ComfyUI that Fuobe's server can reach.";

/**
 * How the owner's GPU choice is offered on this page:
 * - "computer": ComfyUI runs on the owner's computer (their Fuobe tab);
 * - "server": a ComfyUI on the server answers (a connected one always wins, wherever the page is);
 * - "hosted": nothing connected, and the page is not on the server's machine: the computer first, a server address second;
 * - "local": the page is on the server's machine or its network: today's server address.
 * Null until the page knows where it is (hydration).
 */
export type OwnerSteer = "computer" | "server" | "hosted" | "local";

export function ownerSteer(place: PagePlace | null, s: { engineMode?: string; providers?: Record<string, { configured: boolean } | undefined> } | undefined, comfyWhere: string | undefined): OwnerSteer | null {
  if (comfyWhere === "computer") return "computer";
  if (!s || place === null) return null;
  if (s.providers?.comfyui?.configured) return "server";
  return place === "hosted" && s?.engineMode !== "cloud" ? "hosted" : "local";
}
