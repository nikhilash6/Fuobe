import { describe, expect, it } from "vitest";
import { freePick, manualGroups, openLabel, priceText, rank, smartPick, choices, type World } from "@/lib/assist-models";

/*
 * Which model Smart and Free use, and what Manual lists, from what the owner has connected: pure
 * functions over the registry. Smart takes the best connected model (quality tier, then what Assist has
 * really been run with, then no daily cap, speed, price and context), Free the best free one, and both
 * say which model they use. Open source only, the AI helper setting, free-plan ticks and OpenRouter's
 * free tier narrow what may run.
 */

const world = (w: Partial<World> = {}): World => ({ providers: [], local: null, openOnly: false, helper: "auto", smartPlan: "auto", freeOrder: "best", today: "2026-10-31", checker: false, ...w });
const ollama = (model = "qwen3.8:27b", models = [model]) => ({ kind: "ollama", label: "Ollama", ok: true, model, models: models.map((id) => ({ id })) });
const names = (list: { name: string }[]) => list.map((c) => c.name);

describe("Smart", () => {
  it("keeps Claude Opus first while Anthropic is connected, then ranks the rest by tier, cap, speed, price and context", () => {
    const all = ["anthropic", "openai", "google", "xai", "moonshot", "qwen", "deepseek", "zai"].map((id) => ({ id }));
    const s = smartPick(world({ providers: all }));
    expect(s.plan).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(s.text).toBe("Smart uses Claude Opus 5.5 (Anthropic) to plan, pick models and check results.");
    const order = rank(choices(world({ providers: all })).filter((c) => !c.disabled && !c.manualOnly && c.tier === 1));
    expect(names(order)).toEqual(["Claude Opus 5.5", "Qwen3.8-Max", "Grok 4.7", "GPT-6.1 Sol", "Kimi K3.1 Pro", "Gemini 4 Argon"]);
  });

  it("isn't Claude-only: it names the best model connected, from any provider", () => {
    expect(smartPick(world({ providers: [{ id: "openai" }, { id: "deepseek" }] })).text).toBe("Smart uses GPT-6.1 Sol (OpenAI) to plan, pick models and check results.");
    const ds = smartPick(world({ providers: [{ id: "deepseek" }] }));
    expect(ds.plan).toMatchObject({ provider: "deepseek", model: "deepseek-v4-pro", sees: false });
    expect(ds.text).toBe("Smart uses DeepSeek V4 Pro to plan and pick models. It can't see pictures, so it checks results by their prompts — connect a model that can see (Google, OpenAI…) for picture checks.");
  });

  it("with the picture checker on, a model that can see checks for a planner that can't", () => {
    const s = smartPick(world({ providers: [{ id: "deepseek" }], checker: true }));
    expect(s.check).toMatchObject({ provider: "deepseek", model: "deepseek-flash" });
    expect(s.text).toBe("Smart uses DeepSeek V4 Pro to plan and pick models, and DeepSeek V4.1 Flash to check pictures.");
    const z = smartPick(world({ providers: [{ id: "zai" }, { id: "google", freeTick: true }], checker: true }));
    expect(z.plan).toMatchObject({ model: "glm-5.3" });
    expect(z.check).toMatchObject({ provider: "google", model: "gemini-3.8-flash" });
    expect(z.text).toBe("Smart uses GLM-5.3 (Z.ai) to plan and pick models, and Gemini 3.8 Flash (Google, free plan) to check pictures.");
  });

  it("OpenRouter without credits plans on its best free model; with credits, on its best paid one", () => {
    const free = smartPick(world({ providers: [{ id: "openrouter", freeTier: true }] }));
    expect(free.plan).toMatchObject({ model: "nvidia/nemotron-3-ultra-550b-a55b:free" });
    expect(free.text).toBe("Smart uses Nemotron 3 Ultra (free, through OpenRouter). Credits on OpenRouter, or a paid key (Anthropic, OpenAI, Google…), give better plans.");
    const paid = smartPick(world({ providers: [{ id: "openrouter" }] }));
    expect(paid.plan?.provider).toBe("openrouter");
    expect(paid.plan?.tier).toBe(1);
    expect(paid.text).toMatch(/^Smart uses .+ through OpenRouter to plan, pick models and check results\.$/);
  });

  it("the same model on its maker's API comes before a host's copy", () => {
    const list = rank(choices(world({ providers: [{ id: "together" }, { id: "zai" }] })).filter((c) => c.name === "GLM-5.3"));
    expect(list.map((c) => c.provider)).toEqual(["zai", "together"]);
  });

  it("says why when every model connected is blocked, rather than asking for a key that is set", () => {
    expect(smartPick(world({ providers: [{ id: "deepseek", rejected: true }] })).text).toBe("Smart can't plan with DeepSeek V4 Pro: DeepSeek rejected the key — check it in Settings.");
    expect(smartPick(world({ providers: [{ id: "deepseek" }], openOnly: true })).text).toBe("Smart can't plan with DeepSeek V4 Pro: Paid API — Open source only is on (Settings).");
  });

  it("on a local model only, says so; with nothing, can't be picked", () => {
    expect(smartPick(world({ local: ollama() })).text).toBe("Smart uses qwen3.8:27b on Ollama, on this machine.");
    const none = smartPick(world());
    expect(none.plan).toBeNull();
    expect(none.text).toBe("Smart needs a model: add a key in Settings (Anthropic, OpenAI, Google, OpenRouter…) or start a local model.");
  });

  it("never picks Manual-only models, models whose tool calling isn't confirmed, or a rejected key", () => {
    const s = smartPick(world({ providers: [{ id: "moonshot" }] }));
    expect(s.plan?.model).toBe("kimi-k3.1-pro");
    expect(smartPick(world({ providers: [{ id: "google", freeTick: true }] })).plan?.model).not.toBe("gemma-4-31b-it");
    expect(smartPick(world({ providers: [{ id: "deepseek", rejected: true }] })).plan).toBeNull();
  });

  it("follows the owner's override when that model is connected", () => {
    const w = world({ providers: [{ id: "anthropic" }, { id: "deepseek" }], smartPlan: "deepseek|deepseek-v4-pro" });
    expect(smartPick(w).plan).toMatchObject({ provider: "deepseek", model: "deepseek-v4-pro" });
    expect(smartPick({ ...w, smartPlan: "openai|gpt-6.1-sol" }).plan).toMatchObject({ provider: "anthropic" });
  });

  it("AI helper set to Local model only leaves Smart and Manual as they are (it sets the default: Free, local first); set to Claude, Smart is Claude", () => {
    const local = world({ providers: [{ id: "anthropic" }, { id: "openai" }], local: ollama(), helper: "local" });
    expect(smartPick(local).plan).toMatchObject({ provider: "anthropic", model: "claude-opus-5-5" });
    expect(choices(local).filter((c) => c.disabled)).toEqual([]);
    expect(freePick({ ...local, providers: [{ id: "openrouter" }] }).pick).toMatchObject({ local: true });
    expect(smartPick(world({ providers: [{ id: "anthropic" }, { id: "openai" }], helper: "anthropic", openOnly: true })).plan).toMatchObject({ provider: "anthropic" });
  });
});

describe("Free", () => {
  it("offers OpenRouter's free models before a local one, with the limits and what comes next", () => {
    const f = freePick(world({ providers: [{ id: "openrouter", freeLeft: 37, freeLimit: 50 }], local: ollama() }));
    expect(f.pick).toMatchObject({ provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free", free: true });
    expect(f.text).toBe("Runs on Nemotron 3 Ultra through OpenRouter — free: 20 a minute, 50 a day (1,000 a day once you've bought 10 credits) (37 left today). When those run out: qwen3.8:27b on Ollama.");
    // Every OpenRouter free model shares the day's cap: the next choice after them is the local one.
    expect(f.then[0]).toMatchObject({ local: true });
    expect(f.then.at(-1)!.model).toBe("openrouter/free");
  });

  it("puts the local model first when the owner asks, and says when nothing free is connected", () => {
    const f = freePick(world({ providers: [{ id: "openrouter" }], local: ollama(), freeOrder: "local" }));
    expect(f.pick).toMatchObject({ local: true });
    expect(freePick(world({ local: ollama() })).text).toBe("Runs on qwen3.8:27b through Ollama — free, on this machine.");
    const none = freePick(world({ providers: [{ id: "openai" }] }));
    expect(none.pick).toBeNull();
    expect(none.text).toBe("Nothing free is connected. Add an OpenRouter key (free models) or a Z.ai key (free GLM Flash models), or start Ollama, LM Studio or Unsloth Studio. Until then, the offline planner takes simple requests.");
  });

  it("counts a free plan only with the owner's tick, and then offers only that provider's free models", () => {
    expect(freePick(world({ providers: [{ id: "google" }] })).pick).toBeNull();
    const ticked = world({ providers: [{ id: "google", freeTick: true }] });
    const f = freePick(ticked);
    expect(f.pick).toMatchObject({ provider: "google", model: "gemini-3.8-flash" });
    expect(f.pick?.caveat).toBe("Google uses free-tier prompts to improve its products.");
    expect(choices(ticked).find((c) => c.model === "gemini-4-argon")!.disabled).toBe("Your Google key is on the free plan");
  });

  it("never counts trials as free, keeps Groq's free plan out (too small for Assist), and marks Ollama Cloud as paid", () => {
    expect(freePick(world({ providers: [{ id: "qwen" }, { id: "cerebras" }] })).pick).toBeNull();
    const groq = world({ providers: [{ id: "groq", freeTick: true }] });
    expect(freePick(groq).pick).toBeNull();
    expect(choices(groq).find((c) => c.model === "openai/gpt-oss-120b")!.disabled).toMatch(/Too small for Assist/);
    const cloud = freePick(world({ local: ollama("gpt-oss:120b-cloud") }));
    expect(cloud.pick).toBeNull();
  });

  it("skips OpenRouter's free models once the day's free requests are gone (its key check says 0 left)", () => {
    const w = world({ providers: [{ id: "openrouter", freeTier: true, freeLeft: 0, freeLimit: 50 }], local: ollama() });
    expect(choices(w).find((c) => c.model === "nvidia/nemotron-3-ultra-550b-a55b:free")!.disabled).toBe("OpenRouter's free requests for today are used up");
    expect(freePick(w).pick).toMatchObject({ local: true });
    expect(smartPick({ ...w, local: null }).plan).toBeNull();
  });

  it("Z.ai's GLM Flash models are free on any key", () => {
    const f = freePick(world({ providers: [{ id: "zai" }] }));
    expect(f.pick).toMatchObject({ provider: "zai", free: true });
    expect(["glm-4.7-flash", "glm-4.6v-flash"]).toContain(f.pick!.model);
  });
});

describe("Open source only", () => {
  it("runs only open-weight models that cost nothing: on this machine, or a provider's free ones; nothing goes to a paid API", () => {
    const w = world({ providers: [{ id: "anthropic" }, { id: "moonshot" }, { id: "deepseek" }, { id: "openrouter" }], openOnly: true, local: ollama() });
    const all = choices(w);
    expect(all.find((c) => c.model === "kimi-k3.1-pro")!.disabled).toBe("Not open weights — Open source only is on (Settings)");
    expect(all.find((c) => c.model === "claude-opus-5-5")!.disabled).toBeTruthy();
    // Open weights on a paid API: off, as Settings → Engine promises.
    expect(all.find((c) => c.model === "deepseek-v4-pro")!.disabled).toBe("Paid API — Open source only is on (Settings)");
    expect(all.find((c) => c.provider === "openrouter" && c.model === "x-ai/grok-4.7")!.disabled).toBeTruthy();
    // Paid keys alone: Smart plans on the local model, and nothing paid is the default.
    expect(smartPick({ ...w, providers: w.providers.filter((x) => x.id !== "openrouter") }).plan).toMatchObject({ local: true });
    expect(smartPick({ ...w, local: null, providers: [{ id: "deepseek" }] }).plan).toBeNull();
    // OpenRouter's free open models count (its best is free, so it comes first at its tier), and a free plan the owner ticked.
    expect(smartPick(w).plan).toMatchObject({ provider: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" });
    expect(choices(world({ providers: [{ id: "google", freeTick: true }], openOnly: true })).find((c) => c.model === "gemma-4-31b-it")!.disabled).toBeUndefined();
    // AI helper set to Claude is still the owner's way to use Claude on an open-source-only install.
    expect(smartPick({ ...w, helper: "anthropic" }).plan).toMatchObject({ provider: "anthropic" });
    expect(openLabel(all.find((c) => c.model === "deepseek-v4-pro")!)).toBe("Open weights · MIT · runs on DeepSeek's servers");
    expect(openLabel(all.find((c) => c.model === "google/gemma-4-31b-it:free")!)).toBe("Open weights · Apache-2.0 · free through OpenRouter");
    expect(openLabel(all.find((c) => c.local)!)).toBe("Open weights · on this machine");
    const r7b = choices(world({ providers: [{ id: "cohere" }] })).find((c) => c.model === "command-r7b-12-2024")!;
    expect(openLabel(r7b)).toBe("Open weights · CC-BY-NC-4.0 (non-commercial) · runs on Cohere's servers");
    // Hugging Face routes each id to the provider its suffix names: that provider runs it.
    const hf = choices(world({ providers: [{ id: "huggingface" }] }));
    expect(openLabel(hf.find((c) => c.model === "zai-org/GLM-5.3:deepinfra")!)).toBe("Open weights · GLM licence (other) · runs on DeepInfra, through Hugging Face");
    expect(openLabel(hf.find((c) => c.model === "deepseek-ai/DeepSeek-V4.1-Flash-1017:novita")!)).toBe("Open weights · MIT · runs on Novita, through Hugging Face");
    expect(openLabel(hf.find((c) => c.model.endsWith(":baseten"))!)).toMatch(/runs on Baseten, through Hugging Face$/);
  });
});

describe("Manual and the words for prices", () => {
  it("groups connected providers first, then one Add key line for the rest", () => {
    const m = manualGroups(world({ providers: [{ id: "deepseek" }, { id: "anthropic" }], local: ollama("qwen3.8:27b", ["qwen3.8:27b", "gemma4:31b"]) }));
    expect(m.groups.map((g) => g.label)).toEqual(["Anthropic", "DeepSeek", "Ollama"]);
    expect(m.groups[0].models.map((x) => x.name)).toEqual(["Claude Opus 5.5", "Claude Sonnet 5.5", "Claude Haiku 5.5", "Claude Fable 5.1"]);
    expect(m.groups[2].models.map((x) => x.model)).toEqual(["qwen3.8:27b", "gemma4:31b"]);
    expect(m.missing.map((p) => p.id)).toContain("openrouter");
    expect(m.missing.map((p) => p.id)).not.toContain("deepseek");
    expect(m.missing.map((p) => p.id)).not.toContain("ollama");
  });

  it("reads prices like the rest of the app, with dated changes, CNY regions and free limits", () => {
    const c = (provider: string, model: string, w: Partial<World> = {}) => choices(world({ providers: [{ id: provider }], ...w })).find((x) => x.model === model)!;
    expect(priceText(c("openai", "gpt-6.1-sol"))).toBe("$2 in, $10 out per million tokens");
    expect(priceText(c("deepseek", "deepseek-flash"))).toBe("$0.30 in, $1.20 out per million tokens");
    expect(priceText(c("cohere", "command-r7b-12-2024"))).toBe("$0.0375 in, $0.15 out per million tokens");
    expect(priceText(c("google", "gemini-4-argon"))).toBe("$2 in, $10 out per million tokens until 30 Nov, then $4 / $20");
    expect(priceText(choices(world({ providers: [{ id: "moonshot", cny: true }] })).find((x) => x.model === "kimi-k3")!)).toBe("¥20 in, ¥100 out per million tokens");
    expect(priceText(c("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"))).toBe("Free · 20 a minute, 50 a day (1,000 a day once you've bought 10 credits)");
    expect(priceText(c("cohere", "command-a-03-2025"))).toBe("Cohere's price page doesn't list it");
    expect(priceText(choices(world({ local: ollama() })).find((x) => x.local)!)).toBe("Free, on this machine");
  });

  it("lists the effort levels each model offers", () => {
    const c = choices(world({ providers: [{ id: "openai" }, { id: "minimax" }] }));
    expect(c.find((x) => x.model === "gpt-5.4-mini")!.efforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(c.find((x) => x.model === "MiniMax-M3")!.efforts).toEqual([]);
  });
});
