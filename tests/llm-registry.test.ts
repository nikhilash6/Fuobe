import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ASSIST_EFFORTS } from "@/lib/assist";
import { getLlmModel, LLM_PROVIDERS, LLM_REGISTRY_CHECKED, offersFree, priceOn } from "@/lib/catalog/llm-providers";

/*
 * The provider registry is data: these checks keep it honest (official https hosts only, a price or a
 * free status on every model, a licence on every open one, dated prices in order, nothing expired) and
 * tied to Settings (every key is a secret setting, every region pick a validated one).
 */

process.env.FUOBE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "fuobe-llm-registry-"));
const { SETTINGS } = await import("@/server/settings");

/** The hosts each provider's docs give. A base URL anywhere else is a mistake (or worse). */
const OFFICIAL: Record<string, RegExp> = {
  openai: /^(?:us\.|eu\.)?api\.openai\.com$/,
  google: /^generativelanguage\.googleapis\.com$/,
  xai: /^(?:us\.)?api\.x\.ai$/,
  meta: /^api\.meta\.ai$/,
  mistral: /^api\.mistral\.ai$/,
  cohere: /^api\.cohere\.ai$/,
  deepseek: /^api\.deepseek\.com$/,
  moonshot: /^api\.moonshot\.(?:ai|cn)$/,
  zai: /^(?:api\.z\.ai|open\.bigmodel\.cn)$/,
  qwen: /^\{workspace\}\.(?:ap-southeast-1|us-east-1|cn-beijing|cn-hongkong|ap-northeast-1)\.maas\.aliyuncs\.com$/,
  minimax: /^api\.minimax\.(?:io|cn)$/,
  openrouter: /^openrouter\.ai$/,
  groq: /^api\.groq\.com$/,
  cerebras: /^api\.cerebras\.ai$/,
  together: /^(?:us-)?api\.together\.ai$/,
  fireworks: /^api\.fireworks\.ai$/,
  huggingface: /^router\.huggingface\.co$/,
};

const hosted = LLM_PROVIDERS.filter((p) => p.adapter !== "local" && p.adapter !== "anthropic");
const urls = (p: (typeof LLM_PROVIDERS)[number]) => [...(p.regions?.map((r) => r.baseUrl) ?? []), ...(p.baseUrl ? [p.baseUrl] : [])];

describe("LLM provider registry", () => {
  it("has unique provider ids and unique model ids within each provider", () => {
    const ids = LLM_PROVIDERS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of LLM_PROVIDERS) expect(new Set(p.models.map((m) => m.id)).size, p.id).toBe(p.models.length);
    expect(LLM_REGISTRY_CHECKED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("covers the big labs, China's providers and the hosts, with many models", () => {
    for (const id of ["anthropic", "openai", "google", "xai", "meta", "mistral", "cohere", "deepseek", "moonshot", "zai", "qwen", "minimax", "openrouter", "groq", "cerebras", "together", "fireworks", "huggingface"]) {
      expect(LLM_PROVIDERS.some((p) => p.id === id), id).toBe(true);
    }
    expect(LLM_PROVIDERS.flatMap((p) => p.models).length).toBeGreaterThan(100);
  });

  it("names only official https hosts, one per region, never a free URL", () => {
    for (const p of hosted) {
      const list = urls(p);
      expect(list.length, p.id).toBeGreaterThan(0);
      for (const u of list) {
        expect(u.startsWith("https://"), `${p.id} ${u}`).toBe(true);
        const host = u.slice("https://".length).split("/")[0];
        expect(OFFICIAL[p.id]?.test(host), `${p.id} ${host}`).toBe(true);
      }
      if (p.regions) expect(new Set(p.regions.map((r) => r.id)).size).toBe(p.regions.length);
    }
  });

  it("gives every model a price, a free status or a reason there's no price", () => {
    for (const p of LLM_PROVIDERS) {
      for (const m of p.models) expect(!!m.price?.length || !!m.free || !!m.priceNote, `${p.id}/${m.id}`).toBe(true);
    }
  });

  it("keeps dated prices in order, with an open-ended last step", () => {
    for (const p of LLM_PROVIDERS) {
      for (const m of p.models) {
        for (const steps of [m.price, m.priceCny]) {
          if (!steps) continue;
          const untils = steps.slice(0, -1).map((s) => s.until);
          expect(untils.every(Boolean), `${m.id}`).toBe(true);
          expect([...untils].sort(), m.id).toEqual(untils);
          expect(steps.at(-1)!.until, m.id).toBeUndefined();
        }
      }
    }
    // Gemini 4 Argon's launch price ends on 30 Nov.
    const argon = getLlmModel("google", "gemini-4-argon")!;
    expect(priceOn(argon.price, "2026-10-31")).toMatchObject({ in: 2, out: 10 });
    expect(priceOn(argon.price, "2026-12-01")).toMatchObject({ in: 4, out: 20 });
  });

  it("names a licence for every open-weight model, and marks non-commercial ones", () => {
    for (const p of LLM_PROVIDERS) {
      for (const m of p.models) {
        if (m.open) expect(m.open.licence.trim().length, m.id).toBeGreaterThan(2);
        if (m.open && /\bNC\b/.test(m.open.licence)) expect(m.open.nonCommercial, m.id).toBe(true);
      }
    }
    // Weights only promised: closed until they're out.
    expect(getLlmModel("moonshot", "kimi-k3.1-pro")!.open).toBeUndefined();
  });

  it("offers nothing expired, and no deprecated alias", () => {
    for (const p of LLM_PROVIDERS) {
      for (const m of p.models) if (m.expires) expect(m.expires >= LLM_REGISTRY_CHECKED, m.id).toBe(true);
    }
    const all = LLM_PROVIDERS.flatMap((p) => p.models.map((m) => m.id));
    for (const gone of ["mistral-large-latest", "mistral-medium-3-5", "deepseek-chat", "deepseek-reasoner", "kimi-k2.6", "kimi-k2.7-code", "poolside/laguna-s-2.1:free", "poolside/laguna-xs-2.1:free", "command-a-vision-07-2025"]) {
      expect(all, gone).not.toContain(gone);
    }
  });

  it("calls tools on every model Smart or Free may pick, and says why when the docs don't confirm it", () => {
    for (const p of LLM_PROVIDERS) {
      for (const m of p.models) if (m.tools !== true) expect(m.note, m.id).toBeTruthy();
    }
  });

  it("maps efforts to wire values for Fuobe's five levels only", () => {
    const levels = new Set<string>(ASSIST_EFFORTS.map((e) => e.id));
    for (const p of LLM_PROVIDERS) {
      for (const m of p.models) for (const k of Object.keys(m.efforts ?? {})) expect(levels.has(k), `${m.id} ${k}`).toBe(true);
    }
    // Gemini never gets minimal or none; DeepSeek maps medium to high as it does itself.
    expect(Object.values(getLlmModel("google", "gemini-3.8-flash")!.efforts!)).not.toContain("minimal");
    expect(getLlmModel("deepseek", "deepseek-v4-pro")!.efforts!.medium).toBe("high");
  });

  it("points every host's copy at its maker's own model", () => {
    for (const p of LLM_PROVIDERS) {
      for (const m of p.models) {
        if (!m.same) continue;
        const [maker, ...rest] = m.same.split("/");
        expect(getLlmModel(maker, rest.join("/")), `${p.id}/${m.id} → ${m.same}`).toBeTruthy();
      }
    }
  });

  it("keeps every key in a secret setting, and every region pick validated against the registry", () => {
    const settings = SETTINGS as Record<string, { secret?: boolean; options?: readonly string[] }>;
    for (const p of hosted) {
      expect(p.keySetting, p.id).toBeTruthy();
      expect(settings[p.keySetting!]?.secret, `${p.id} ${p.keySetting}`).toBe(true);
      if (p.regions && p.regions.length > 1) {
        expect(p.regionSetting, p.id).toBeTruthy();
        expect(settings[p.regionSetting!]?.options, p.id).toEqual(p.regions.map((r) => r.id));
      }
      if (p.freePlan?.setting) expect(settings[p.freePlan.setting]?.options, p.id).toEqual(["0", "1"]);
    }
    expect(settings.anthropicKey.secret).toBe(true);
  });

  it("reads keys only from names meant for that provider's API, never a token other tools set for something else", () => {
    const env = (name: string) => [(SETTINGS as Record<string, { env?: string | string[] }>)[name]?.env ?? []].flat();
    // HF_TOKEN is what Fuobe's own download commands ask for; GOOGLE_API_KEY is set by Google Cloud tools for other APIs.
    expect(env("huggingfaceToken")).toEqual(["FUOBE_HF_TOKEN"]);
    expect(env("googleKey")).toEqual(["GEMINI_API_KEY"]);
    const all = Object.keys(SETTINGS).flatMap(env);
    expect(all).not.toContain("HF_TOKEN");
    expect(all).not.toContain("GOOGLE_API_KEY");
  });

  it("tags a provider Free only when Assist can run on its free models", () => {
    const tagged = LLM_PROVIDERS.filter(offersFree).map((p) => p.id);
    expect(tagged).toEqual(expect.arrayContaining(["openrouter", "google", "zai", "mistral"]));
    // Groq's free plan allows 8,000 tokens a minute: one Assist step is more.
    expect(tagged).not.toContain("groq");
    // Trials run out: never tagged.
    expect(tagged).not.toContain("cerebras");
    expect(tagged).not.toContain("qwen");
  });

  it("keeps a model's input limit where the docs give one apart from the context (GPT-5.4 Mini: 400K context, 272K in)", () => {
    const mini = getLlmModel("openai", "gpt-5.4-mini")!;
    expect(mini).toMatchObject({ context: 400_000, maxIn: 272_000 });
    // The over-272K price step can't happen on a model that takes 272K at most.
    expect(mini.longContext).toBeUndefined();
  });
});
