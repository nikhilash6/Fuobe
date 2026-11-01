import "server-only";
import { getSetting, isCandidate, parseContext, savedSetting, type SettingName } from "../settings";
import { LOCAL_KINDS, type LocalKind, type LocalServer } from "./types";

export const LOCAL_LABELS: Record<LocalKind, string> = { ollama: "Ollama", lmstudio: "LM Studio", unsloth: "Unsloth Studio", custom: "your local server" };

/** "your local server" at the start of a sentence. */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Settings → AI helper. The old value "ollama" means a local model only, whichever server runs it. */
export function aiHelper(): "auto" | "anthropic" | "local" | "none" {
  const v = getSetting("enhanceProvider");
  return v === "ollama" ? "local" : (v as "auto" | "anthropic" | "local" | "none");
}

/** The local server Settings pins (null: Automatic). */
export function pinnedKind(): LocalKind | null {
  const v = getSetting("llmProvider");
  return v === "auto" ? null : (v as LocalKind);
}

/** Tokens of context the local model should have; 0 leaves it to the server. A value that isn't a size gets 16384. */
export function llmContext(): number {
  return parseContext(getSetting("llmContext")) ?? 16384;
}

/** The server root: no trailing slash, and no /v1 (or Ollama's /api) pasted from an example. */
const root = (url: string) =>
  url
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/(?:api\/v[01]|v1|api)$/i, "");

/** The custom server's URL as given, without a trailing slash. */
const customRoot = (url: string) => url.trim().replace(/\/+$/, "");

/**
 * A server's key. During Save & test of an address that isn't the saved one, the saved key stays with
 * the server it was saved for (as ComfyUI's token does): only a key typed for this test goes to the new address.
 */
function keyFor(urlName: SettingName, keyName: SettingName, norm: (url: string) => string): string {
  if (isCandidate(urlName) && !isCandidate(keyName) && norm(getSetting(urlName)) !== norm(savedSetting(urlName))) return "";
  return getSetting(keyName);
}

export function localServer(kind: LocalKind): LocalServer {
  const label = LOCAL_LABELS[kind];
  if (kind === "ollama") return { kind, label, url: root(getSetting("ollamaUrl")), model: getSetting("ollamaModel").trim(), key: "" };
  if (kind === "lmstudio") return { kind, label, url: root(getSetting("lmstudioUrl")), model: getSetting("lmstudioModel").trim(), key: keyFor("lmstudioUrl", "lmstudioToken", root) };
  if (kind === "unsloth") return { kind, label, url: root(getSetting("unslothUrl")), model: getSetting("unslothModel").trim(), key: keyFor("unslothUrl", "unslothKey", root) };
  return { kind, label, url: customRoot(getSetting("llmUrl")), model: getSetting("llmModel").trim(), key: keyFor("llmUrl", "llmKey", customRoot) };
}

/** The servers text steps and Assist may use, in the order they're tried: the pinned one, or all (the custom one when it has a URL). */
export function localServers(): LocalServer[] {
  const pinned = pinnedKind();
  if (pinned) return [localServer(pinned)];
  return LOCAL_KINDS.map(localServer).filter((s) => s.kind !== "custom" || s.url);
}

/** Every server, for Settings (the custom one even without a URL). */
export const allLocalServers = (): LocalServer[] => LOCAL_KINDS.map(localServer);

/**
 * Where the OpenAI-compatible API lives. LM Studio and Unsloth: {root}/v1. A custom URL is an OpenAI
 * "base URL" as the server's docs give it (http://host:8080/v1); a bare host gets /v1 added.
 */
export function openaiBase(s: LocalServer): string {
  if (s.kind !== "custom") return `${s.url}/v1`;
  try {
    return new URL(s.url).pathname.replace(/\/+$/, "") ? s.url : `${s.url}/v1`;
  } catch {
    return `${s.url}/v1`;
  }
}

export const authHeaders = (s: LocalServer): Record<string, string> => (s.key ? { Authorization: `Bearer ${s.key}` } : {});
