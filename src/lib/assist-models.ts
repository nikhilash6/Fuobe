import { ASSIST_EFFORTS, type AssistEffort, type AssistModelOption } from "./assist";
import { KNOWN_LOCAL_MODELS, LLM_PROVIDERS, priceOn, type LlmModelDef, type LlmProviderDef, type PriceStep } from "./catalog/llm-providers";

/**
 * Which model Assist's Smart and Free use, and what Manual lists, from what the owner has connected.
 * Pure functions over the registry (src/lib/catalog/llm-providers.ts): the server builds the World
 * from Settings and the local servers' answers, and the browser only gets the results (GET /api/assist).
 *
 * Smart takes the best connected model: quality tier first, then a model Assist has really been run
 * with, then speed, price (input-heavy: (3 × in + out) ÷ 4) and a choice with no daily cap, then the
 * larger context; a maker's own API before a host's copy. Free takes the best free one, with no daily
 * cap first (a free limit that runs out mid-chat costs a step), and says what comes after it.
 */

export interface ConnectedProvider {
  id: string;
  /** The free-plan tick in Settings (Gemini free tier, Mistral Free mode, Cohere trial key, Groq Free plan). */
  freeTick?: boolean;
  /** A China region: prices in CNY. */
  cny?: boolean;
  /** The last real call said the key is wrong. */
  rejected?: boolean;
  /** OpenRouter: no credits bought yet, so only its free models run. */
  freeTier?: boolean;
  /** OpenRouter: free requests left today, and the day's limit. */
  freeLeft?: number | null;
  freeLimit?: number | null;
}

export interface LocalWorld {
  kind: string;
  /** "Ollama", "LM Studio"… */
  label: string;
  /** It answers with a model to use. */
  ok: boolean;
  /** The model a chat uses by default. */
  model: string | null;
  models: { id: string; vision?: boolean }[];
}

export interface World {
  providers: ConnectedProvider[];
  local: LocalWorld | null;
  /** Settings → Engine: Open source only. */
  openOnly: boolean;
  /** Settings → AI helper → Use: "none" turns Assist's models off; "local" makes Free (local first) the default; "anthropic" allows Claude on Open source only. */
  helper: "auto" | "anthropic" | "local" | "none";
  /** Settings → AI helper → Smart plans with: "auto", or "provider|model". */
  smartPlan: string;
  /** Settings → AI helper → Free uses. */
  freeOrder: "best" | "local";
  /** YYYY-MM-DD, for dated prices and free models that expire. */
  today: string;
  /** A model that can see checks pictures for a planner that can't (check_generations look). */
  checker: boolean;
  /** Providers whose free requests are used up for now: their free models are skipped. */
  spent?: string[];
}

export interface Choice {
  /** "anthropic", "openai"…; a local server's kind for local models. */
  provider: string;
  model: string;
  name: string;
  providerLabel: string;
  /** The provider's name in a sentence ("Google"). */
  providerShort: string;
  agent: "claude" | "hosted" | "local";
  tier: 1 | 2 | 3 | 4;
  speed: "fast" | "normal" | "slow";
  context: number;
  sees: boolean;
  /** Costs nothing here: local, a free model, or a free plan the owner ticked. */
  free: boolean;
  /** A daily or monthly cap (free models and plans). */
  cap: boolean;
  /** The cap covers every free model of the provider (OpenRouter's). */
  sharedCap: boolean;
  local: boolean;
  tested: boolean;
  /** A host's copy of a maker's model. */
  host: boolean;
  /** For a host's copy: the maker's own model ("zai/glm-5.3"). */
  same?: string;
  router: boolean;
  tools: boolean;
  manualOnly?: string;
  price?: PriceStep;
  next?: PriceStep;
  cny?: boolean;
  priceNote?: string;
  limits?: string;
  /** "37 left today". */
  left?: string;
  caveat?: string;
  /** Open weights and the licence ("MIT"); absent: closed or unknown. */
  licence?: string;
  nonCommercial?: boolean;
  /** The levels this model offers, in the effort row's order. */
  efforts: AssistEffort[];
  note?: string;
  /** Why it can't be picked now (greyed in Manual, skipped by Smart and Free). */
  disabled?: string;
  /** Registry order, the last tie-break. */
  order: number;
}

const SPEED = { fast: 0, normal: 1, slow: 2 } as const;
/** Ollama Cloud models (gpt-oss:120b-cloud…) run on Ollama's servers and are billed: never Free. */
const CLOUD = /-cloud$|:cloud$/;

/** Input-heavy (an Assist step sends about 9,000 tokens and gets 300–2,000 back): (3 × in + out) ÷ 4 per million. */
const blended = (c: Choice) => (c.free ? 0 : c.price ? (3 * c.price.in + c.price.out) / 4 : Infinity);

const effortsOf = (m: Pick<LlmModelDef, "efforts">): AssistEffort[] => ASSIST_EFFORTS.map((e) => e.id).filter((e) => m.efforts?.[e] !== undefined && m.efforts?.[e] !== null);

/** $0 on this account: a free model, or a free-plan model while the owner's tick is on. */
const costsNothing = (p: LlmProviderDef, m: LlmModelDef, conn: ConnectedProvider) => m.free === "model" || (m.free === "plan" && p.freePlan?.kind === "plan" && !!conn.freeTick);

/**
 * Why a model can't run now. Open source only runs open weights that cost nothing (Settings → Engine: "nothing is
 * sent to paid APIs"); AI helper set to Claude is the owner's way to use Claude there anyway, as before.
 */
function disabledWhy(w: World, p: LlmProviderDef, m: LlmModelDef, conn: ConnectedProvider): string | undefined {
  if (w.helper === "none") return "The AI helper is off (Settings)";
  if (conn.rejected) return `${p.label} rejected the key — check it in Settings`;
  if (w.openOnly && !(p.id === "anthropic" && w.helper === "anthropic")) {
    if (!m.open) return "Not open weights — Open source only is on (Settings)";
    if (!costsNothing(p, m, conn)) return "Paid API — Open source only is on (Settings)";
  }
  if (p.freePlan?.kind === "plan" && conn.freeTick) {
    if (m.free !== "plan") return `Your ${p.short} key is on the free plan`;
    if (p.freePlan.tooSmall) return p.freePlan.tooSmall;
  }
  if (p.id === "openrouter" && conn.freeTier && m.free !== "model") return "No credits on OpenRouter yet: only its free models run";
  // OpenRouter's key check: no free request left today.
  if (m.free === "model" && conn.freeLeft === 0) return `${p.short}'s free requests for today are used up`;
  if (w.spent?.includes(p.id) && (m.free === "model" || (m.free === "plan" && conn.freeTick))) return `${p.short}'s free requests are used up for now`;
  return undefined;
}

/** Every model of the connected providers and the local server, with why each can't run now. */
export function choices(w: World): Choice[] {
  const out: Choice[] = [];
  let order = 0;
  for (const p of LLM_PROVIDERS) {
    if (p.adapter === "local") continue;
    const conn = w.providers.find((x) => x.id === p.id);
    if (!conn) continue;
    for (const m of p.models) {
      if (m.expires && m.expires < w.today) continue;
      const free = costsNothing(p, m, conn);
      const steps = conn.cny && m.priceCny ? m.priceCny : m.price;
      const price = priceOn(steps, w.today);
      const next = price?.until ? steps?.[steps.indexOf(price) + 1] : undefined;
      const limits = free ? (m.free === "model" ? p.freeLimits?.text : p.freePlan?.limits) : undefined;
      const shared = free && !!p.freeLimits?.shared && m.free === "model";
      out.push({
        provider: p.id,
        model: m.id,
        name: m.name,
        providerLabel: p.label,
        providerShort: p.short,
        agent: p.adapter === "anthropic" ? "claude" : "hosted",
        tier: m.tier,
        speed: m.speed,
        context: Math.min(m.context, m.maxIn ?? Infinity),
        sees: m.vision,
        free,
        cap: free,
        sharedCap: shared,
        local: false,
        tested: !!m.tested,
        host: !!m.same,
        ...(m.same && { same: m.same }),
        router: !!m.router,
        tools: m.tools === true,
        ...(m.manualOnly && { manualOnly: m.manualOnly }),
        ...(price && { price }),
        ...(next && { next }),
        ...(conn.cny && m.priceCny && { cny: true }),
        ...(m.priceNote && { priceNote: m.priceNote }),
        ...(limits && { limits }),
        ...(shared && typeof conn.freeLeft === "number" && { left: `${conn.freeLeft} left today` }),
        ...(free && (m.free === "model" ? p.freeLimits?.caveat : p.freePlan?.caveat) && { caveat: (m.free === "model" ? p.freeLimits?.caveat : p.freePlan?.caveat)! }),
        ...(m.open && { licence: m.open.licence, ...(m.open.nonCommercial && { nonCommercial: true }) }),
        efforts: effortsOf(m),
        ...(m.note && { note: m.note }),
        ...(disabledWhy(w, p, m, conn) && { disabled: disabledWhy(w, p, m, conn) }),
        order: order++,
      });
    }
  }
  const l = w.local;
  if (l) {
    const ids = l.models.length ? l.models : l.model ? [{ id: l.model }] : [];
    for (const lm of ids) {
      const known = KNOWN_LOCAL_MODELS.find((k) => k.match.test(lm.id));
      const cloud = CLOUD.test(lm.id);
      out.push({
        provider: l.kind,
        model: lm.id,
        name: lm.id,
        providerLabel: l.label,
        providerShort: l.label,
        agent: "local",
        tier: 4,
        speed: "normal",
        context: 0,
        sees: lm.vision ?? known?.vision ?? false,
        free: !cloud,
        cap: false,
        sharedCap: false,
        local: true,
        tested: false,
        host: false,
        router: false,
        tools: true,
        ...(known && { licence: known.licence }),
        efforts: [],
        ...(cloud && { note: "Ollama Cloud · paid" }),
        ...(w.helper === "none" ? { disabled: "The AI helper is off (Settings)" } : !l.ok ? { disabled: `${l.label} isn't ready` } : {}),
        order: order++,
      });
    }
  }
  return out;
}

type Cmp = (a: Choice, b: Choice) => number;
const by =
  (...keys: ((c: Choice) => number)[]): Cmp =>
  (a, b) => {
    for (const k of keys) {
      const d = k(a) - k(b);
      if (d) return d;
    }
    return 0;
  };
const tierOf = (c: Choice) => (c.router ? 5 : c.tier);
const KEYS = {
  tier: tierOf,
  tested: (c: Choice) => (c.tested ? 0 : 1),
  speed: (c: Choice) => SPEED[c.speed],
  price: blended,
  cap: (c: Choice) => (c.cap ? 1 : 0),
  context: (c: Choice) => -c.context,
  host: (c: Choice) => (c.host ? 1 : 0),
  order: (c: Choice) => c.order,
};

/** A host's copy right after its maker's own model when both are in the list (the maker's API comes first). */
function makerFirst(sorted: Choice[]): Choice[] {
  const key = (c: Choice) => `${c.provider}/${c.model}`;
  const present = new Set(sorted.map(key));
  const copies = sorted.filter((c) => c.same && present.has(c.same));
  const out = sorted.filter((c) => !copies.includes(c));
  for (const c of copies) out.splice(out.findLastIndex((x) => key(x) === c.same || x.same === c.same) + 1, 0, c);
  return out;
}

/** Smart's order: tier, run with Assist for real, speed, price, no cap, context, registry order; a maker before a host's copy of its model. */
export const rank = (list: Choice[]): Choice[] => makerFirst([...list].sort(by(KEYS.tier, KEYS.tested, KEYS.speed, KEYS.price, KEYS.cap, KEYS.context, KEYS.host, KEYS.order)));

/** Free's order: as Smart's, with no daily cap before speed (prices are all 0). */
const rankFree = (list: Choice[]): Choice[] => makerFirst([...list].sort(by(KEYS.tier, KEYS.tested, KEYS.cap, KEYS.speed, KEYS.context, KEYS.host, KEYS.order)));

/** The checker's order: short one-shot calls, so speed comes before tier among the strong models (T1–T2). */
const rankCheck = (list: Choice[]): Choice[] => makerFirst([...list].sort(by((c) => (tierOf(c) <= 2 ? 1 : tierOf(c)), KEYS.speed, KEYS.tier, KEYS.price, KEYS.cap, KEYS.context, KEYS.host, KEYS.order)));

/** Smart and Free may pick it: it can run now, calls tools for sure, and isn't Manual-only. */
const usable = (c: Choice) => !c.disabled && c.tools && !c.manualOnly;

/** Only the local server's default model stands for "the local model" in Smart and Free. */
const pickable = (w: World) => choices(w).filter((c) => usable(c) && (!c.local || c.model === w.local?.model));

/** "GPT-6.1 Sol (OpenAI)": the provider in brackets unless the name already says it. */
function who(c: Choice, extra?: string): string {
  if (c.local) return `${c.name} on ${c.providerLabel}`;
  const said = c.name.toLowerCase().startsWith(c.providerShort.toLowerCase());
  const bits = [...(said ? [] : [c.providerShort]), ...(extra ? [extra] : [])];
  return bits.length ? `${c.name} (${bits.join(", ")})` : c.name;
}

export interface SmartPick {
  plan: Choice | null;
  /** A model that can see, for a planner that can't (null: the planner checks, or nothing can see). */
  check: Choice | null;
  text: string;
}

/** Smart: the best connected model plans and picks models; the best one that can see checks pictures when the planner can't. */
export function smartPick(w: World): SmartPick {
  const all = pickable(w);
  const [pid, mid] = w.smartPlan.split("|");
  const fixed = w.smartPlan !== "auto" ? all.find((c) => c.provider === pid && c.model === mid) : undefined;
  const claude = w.helper === "anthropic" ? all.find((c) => c.provider === "anthropic" && c.model === "claude-opus-5-5") : undefined;
  const plan = fixed ?? claude ?? rank(all)[0] ?? null;
  if (!plan) {
    // Models are connected but none can run now (a rejected key, Open source only…): say why, not "add a key".
    const blocked = rank(choices(w).filter((c) => c.disabled && c.tools && !c.manualOnly && (!c.local || c.model === w.local?.model)))[0];
    const text = blocked ? `Smart can't plan with ${who(blocked)}: ${blocked.disabled}.` : "Smart needs a model: add a key in Settings (Anthropic, OpenAI, Google, OpenRouter…) or start a local model.";
    return { plan: null, check: null, text };
  }
  if (plan.local) return { plan, check: null, text: `Smart uses ${plan.name} on ${plan.providerLabel}, on this machine.` };
  if (plan.free && plan.provider === "openrouter") {
    return { plan, check: null, text: `Smart uses ${plan.name} (free, through OpenRouter). Credits on OpenRouter, or a paid key (Anthropic, OpenAI, Google…), give better plans.` };
  }
  const through = plan.host || plan.provider === "openrouter" ? `${plan.name} through ${plan.providerLabel}` : who(plan, plan.free ? "free plan" : undefined);
  if (plan.sees) return { plan, check: null, text: `Smart uses ${through} to plan, pick models and check results.` };
  const check = w.checker ? (rankCheck(all.filter((c) => c.sees))[0] ?? null) : null;
  if (check) return { plan, check, text: `Smart uses ${through} to plan and pick models, and ${who(check, check.free && !check.local ? "free plan" : undefined)} to check pictures.` };
  return { plan, check: null, text: `Smart uses ${through} to plan and pick models. It can't see pictures, so it checks results by their prompts — connect a model that can see (Google, OpenAI…) for picture checks.` };
}

export interface FreePick {
  pick: Choice | null;
  /** What comes next when the pick's free limit runs out (other providers first: a shared cap ends all of a provider's free models). */
  then: Choice[];
  text: string;
}

const NOTHING_FREE =
  "Nothing free is connected. Add an OpenRouter key (free models) or a Z.ai key (free GLM Flash models), or start Ollama, LM Studio or Unsloth Studio. Until then, the offline planner takes simple requests.";

const runsOn = (c: Choice) => (c.local ? `${c.name} on ${c.providerLabel}` : `${c.name} through ${c.providerLabel}`);

/** Free: the best free model (or the local one first, if the owner asks or AI helper is Local model only), then the next ones, then the offline planner. */
export function freePick(w: World): FreePick {
  const free = rankFree(pickable(w).filter((c) => c.free));
  const ordered = w.freeOrder === "local" || w.helper === "local" ? [...free.filter((c) => c.local), ...free.filter((c) => !c.local)] : free;
  const [pick, ...rest] = ordered;
  if (!pick) return { pick: null, then: [], text: NOTHING_FREE };
  const sharing = (c: Choice) => pick.sharedCap && c.sharedCap && c.provider === pick.provider;
  const then = [...rest.filter((c) => !sharing(c) && !c.router), ...rest.filter((c) => sharing(c) && !c.router), ...rest.filter((c) => c.router)];
  if (pick.local) return { pick, then, text: `Runs on ${pick.name} through ${pick.providerLabel} — free, on this machine.` };
  const after = then.find((c) => !sharing(c));
  const left = pick.left ? ` (${pick.left})` : "";
  return { pick, then, text: `Runs on ${runsOn(pick)} — free: ${pick.limits ?? "limits not published"}${left}.${after ? ` When those run out: ${runsOn(after)}.` : ""}` };
}

export interface ManualGroup {
  id: string;
  label: string;
  /** "Key set", "Free plan", "No credits yet", "Key rejected", or the local server's state. */
  status: string;
  models: Choice[];
}

/** Manual: each connected provider's models, grouped in the registry's order (local last), and the providers to add a key for. */
export function manualGroups(w: World): { groups: ManualGroup[]; missing: { id: string; label: string }[] } {
  const all = choices(w);
  const groups: ManualGroup[] = [];
  for (const p of LLM_PROVIDERS) {
    if (p.adapter === "local") continue;
    const conn = w.providers.find((x) => x.id === p.id);
    if (!conn) continue;
    const status = conn.rejected ? "Key rejected" : conn.freeTick && p.freePlan?.kind === "plan" ? "Free plan" : conn.freeTier ? "Free models only" : "Key set";
    groups.push({ id: p.id, label: p.label, status, models: all.filter((c) => c.provider === p.id && !c.local) });
  }
  const local = all.filter((c) => c.local);
  if (w.local && local.length) groups.push({ id: w.local.kind, label: w.local.label, status: w.local.ok ? "On this machine" : "Not ready", models: local });
  const missing = LLM_PROVIDERS.filter((p) => p.adapter !== "local" && !w.providers.some((x) => x.id === p.id)).map((p) => ({ id: p.id, label: p.label }));
  return { groups, missing };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "$2", "$0.30", "$0.0375": whole amounts plain, cents with two places, smaller ones as the page gives them. */
const money = (n: number, cny?: boolean) => `${cny ? "¥" : "$"}${Number.isInteger(n) ? n : Number(n.toFixed(2)) === n ? n.toFixed(2) : Number(n.toFixed(4)).toString()}`;
const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

/** "$2 in, $10 out per million tokens", "… until 30 Nov, then $4 / $20", "Free · 20 a minute, 50 a day", "Free, on this machine". */
export function priceText(c: Choice): string {
  if (c.local) return c.free ? "Free, on this machine" : "Ollama Cloud · paid";
  if (c.free) return c.limits ? `Free · ${c.limits}` : "Free";
  if (!c.price) return c.priceNote ?? "Price not published";
  const now = `${money(c.price.in, c.cny)} in, ${money(c.price.out, c.cny)} out per million tokens`;
  return c.next && c.price.until ? `${now} until ${day(c.price.until)}, then ${money(c.next.in, c.cny)} / ${money(c.next.out, c.cny)}` : now;
}

/** What the browser gets for a choice: words and flags, never a key or an address. */
export function toOption(c: Choice): AssistModelOption {
  const open = openLabel(c);
  return {
    provider: c.provider,
    model: c.model,
    name: c.name,
    providerLabel: c.providerLabel,
    agent: c.agent,
    price: priceText(c),
    ...(c.note && { note: c.note }),
    ...(open && { open }),
    ...(c.caveat && { caveat: c.caveat }),
    sees: c.sees,
    free: c.free,
    efforts: c.efforts,
    ...(c.disabled && { disabled: c.disabled }),
    ...(c.manualOnly && { manualOnly: c.manualOnly }),
  };
}

/** Hugging Face's router: the provider an id's suffix names runs the model ("zai-org/GLM-5.3:deepinfra"). */
const ROUTED: Record<string, string> = {
  deepinfra: "DeepInfra",
  novita: "Novita",
  baseten: "Baseten",
  cerebras: "Cerebras",
  groq: "Groq",
  together: "Together AI",
  "fireworks-ai": "Fireworks AI",
  nebius: "Nebius",
  sambanova: "SambaNova",
};
const routedTo = (c: Choice) => {
  const suffix = c.provider === "huggingface" ? /:([\w-]+)$/.exec(c.model)?.[1] : undefined;
  return suffix ? (ROUTED[suffix] ?? suffix) : undefined;
};

/** "Open weights · MIT · runs on DeepSeek's servers", "… · runs on DeepInfra, through Hugging Face"; undefined for a closed (or not confirmed open) model. */
export function openLabel(c: Choice): string | undefined {
  if (c.local) return "Open weights · on this machine";
  if (!c.licence) return undefined;
  const licence = c.nonCommercial ? `${c.licence} (non-commercial)` : c.licence;
  const host = routedTo(c);
  const where =
    c.provider === "openrouter" ? (c.free ? "free through OpenRouter" : "runs through OpenRouter") : host ? `runs on ${host}, through ${c.providerLabel}` : `runs on ${c.providerShort}'s servers`;
  return `Open weights · ${licence} · ${where}`;
}
