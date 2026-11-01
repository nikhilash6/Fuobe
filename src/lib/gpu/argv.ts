import type { ComfyFlags } from "./types";

/**
 * Read ComfyUI's launch flags from system_stats.system.argv (SPEC §6.1). Both "--flag value" and
 * "--flag=value" count. A flag that takes an optional value (--listen, --enable-cors-header) has none
 * when the next word is another flag or the end.
 */
export function parseArgv(argv: unknown): ComfyFlags {
  const args = Array.isArray(argv) ? argv.filter((a): a is string => typeof a === "string") : [];
  const has = (flag: string) => args.some((a) => a === flag || a.startsWith(`${flag}=`));
  /** undefined: absent; null: present with no value; else the value. */
  const value = (flag: string): string | null | undefined => {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith(`${flag}=`)) return a.slice(flag.length + 1);
      if (a === flag) {
        const next = args[i + 1];
        return next !== undefined && !next.startsWith("--") ? next : null;
      }
    }
    return undefined;
  };
  const listenRaw = value("--listen");
  // Absent: loopback only. No value: every address (0.0.0.0 and ::). A value: a comma-separated list.
  const listen = listenRaw === undefined ? null : listenRaw === null || listenRaw === "" ? "0.0.0.0,::" : listenRaw;
  const loopback = (h: string) => /^127\./.test(h) || h === "::1" || h === "[::1]" || h.toLowerCase() === "localhost";
  const hosts = (listen ?? "").split(",").map((h) => h.trim()).filter(Boolean);
  const cors = value("--enable-cors-header");
  return {
    listen,
    loopbackOnly: listen === null || (hosts.length > 0 && hosts.every(loopback)),
    corsOrigin: cors === undefined ? null : cors === null || cors === "" ? "*" : cors,
    enableManager: has("--enable-manager"),
    managerLegacyUi: has("--enable-manager-legacy-ui"),
    lowvram: has("--lowvram") || has("--novram"),
    cpuOnly: has("--cpu"),
  };
}
