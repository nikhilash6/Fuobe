import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startFakeBilling, FAKE_POLICY, type FakeBilling } from "./helpers/fake-billing";
import { tempDir } from "./helpers/temp-dir";

/*
 * The name visitors read for this install's GPUs while hosted runs are on ("Runs on our GPUs"): the billing service's
 * policy first, then the install's own setting (Settings → Workers), then FUOBE_PLACE_NAME, then "Our GPUs". A leading
 * "Our " reads "our " inside a sentence, a name is cut at 40 characters, and nothing of it reaches a visitor while
 * hosted runs are off.
 */

process.env.FUOBE_DATA_DIR = tempDir("fuobe-place-name-");
process.env.FUOBE_PUBLIC_SIGNUP = "1";
for (const k of ["FUOBE_PASSWORD", "FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN", "FUOBE_PLACE_NAME"]) delete process.env[k];

const { cleanPlaceName, knownPlace, notePlaceName, PLACE_NAME_DEFAULT, PLACE_NAME_MAX, placeOf } = await import("@/lib/place-name");
const { placeName } = await import("@/server/place-name");
const settings = await import("@/server/settings");
const billing = await import("@/server/billing");
const auth = await import("@/server/auth");
const { visitorStatus } = await import("@/server/account-gpu");
const { ownGpuQuiet } = await import("@/server/hosted-run");
const { usePlaceName } = await import("@/lib/api");

let fake: FakeBilling;
let accountId = "";
beforeAll(async () => {
  fake = await startFakeBilling();
  auth.setPassword("install password");
  accountId = auth.createAccount("place@example.com", "long enough").id;
});
afterAll(async () => {
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN", "FUOBE_PLACE_NAME"]) delete process.env[k];
  await fake.close();
});
beforeEach(() => {
  for (const k of ["FUOBE_HOSTED_RUNS", "FUOBE_HOSTED_FREE", "FUOBE_BILLING_URL", "FUOBE_BILLING_TOKEN", "FUOBE_PLACE_NAME"]) delete process.env[k];
  settings.setSetting("hostedPlaceName", "");
  billing.resetBillingCache();
  fake.policy = { ...FAKE_POLICY };
});

describe("a place name as it is kept", () => {
  it("one line, spaces folded, at most 40 characters, never half an emoji", () => {
    expect(cleanPlaceName("  Ana's   render\nbox ")).toBe("Ana's render box");
    expect(cleanPlaceName("")).toBeNull();
    expect(cleanPlaceName("   ")).toBeNull();
    expect(cleanPlaceName(42)).toBeNull();
    expect(cleanPlaceName(undefined)).toBeNull();
    const long = "A".repeat(39) + "🎬🎬";
    expect(Array.from(cleanPlaceName(long)!)).toHaveLength(PLACE_NAME_MAX);
    expect(cleanPlaceName(long)!.endsWith("🎬")).toBe(true);
    expect(cleanPlaceName("x".repeat(60))).toHaveLength(PLACE_NAME_MAX);
  });
  it("as a label and inside a sentence: a leading Our reads our", () => {
    expect(placeOf(null)).toEqual({ label: PLACE_NAME_DEFAULT, text: "our GPUs" });
    expect(PLACE_NAME_DEFAULT).toBe("Our GPUs");
    expect(placeOf("Our render farm")).toEqual({ label: "Our render farm", text: "our render farm" });
    expect(placeOf("Ana's render box")).toEqual({ label: "Ana's render box", text: "Ana's render box" });
    expect(placeOf("Ourselves")).toEqual({ label: "Ourselves", text: "Ourselves" });
  });
  it("words outside React use the name the status gave last", () => {
    notePlaceName("Studio North GPUs");
    expect(knownPlace().label).toBe("Studio North GPUs");
    notePlaceName(null);
    expect(knownPlace().label).toBe("Our GPUs");
  });
  it("the question for an own GPU that didn't answer names it, with no verb to agree", () => {
    expect(ownGpuQuiet(placeOf("Studio North GPUs"))).toBe("Your GPU isn't answering right now. Run this on Studio North GPUs instead, or wait for your GPU.");
  });
});

describe("where the name comes from (first match wins)", () => {
  it("the default, then FUOBE_PLACE_NAME, then the install's setting, then the billing service's policy", () => {
    expect(placeName()).toBe("Our GPUs");
    process.env.FUOBE_PLACE_NAME = "Env box";
    expect(placeName()).toBe("Env box");
    settings.setSetting("hostedPlaceName", "Ana's render box");
    expect(placeName()).toBe("Ana's render box");
    expect(placeName({ placeName: "Studio North GPUs" })).toBe("Studio North GPUs");
    // A policy with no name, or an empty or odd one, leaves the install's.
    expect(placeName({})).toBe("Ana's render box");
    expect(placeName({ placeName: "  " })).toBe("Ana's render box");
    expect(placeName({ placeName: 7 as unknown as string })).toBe("Ana's render box");
    // A long policy name is cut at 40 characters.
    expect(placeName({ placeName: "N".repeat(80) })).toHaveLength(PLACE_NAME_MAX);
  });
  it("the setting takes one line of at most 40 characters", () => {
    expect(() => settings.validateSetting("hostedPlaceName", "x".repeat(PLACE_NAME_MAX), "api")).not.toThrow();
    expect(() => settings.validateSetting("hostedPlaceName", "x".repeat(PLACE_NAME_MAX + 1), "api")).toThrow(/at most 40/);
    expect(() => settings.validateSetting("hostedPlaceName", "two\nlines", "api")).toThrow(/one line/);
    expect(() => settings.validateSetting("hostedPlaceName", "", "api")).not.toThrow();
  });
});

describe("what a visitor's status says", () => {
  it("nothing while hosted runs are off, whatever the install names its GPUs", async () => {
    process.env.FUOBE_PLACE_NAME = "Env box";
    settings.setSetting("hostedPlaceName", "Ana's render box");
    for (const s of [await visitorStatus(auth.accountById(accountId)!), await visitorStatus(null)]) expect(s.viewer).not.toHaveProperty("placeName");
  });
  it("hosted runs on with no service: the install's name, else the default, to a guest and an account", async () => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    process.env.FUOBE_HOSTED_FREE = "1";
    expect((await visitorStatus(auth.accountById(accountId)!)).viewer.placeName).toBe("Our GPUs");
    settings.setSetting("hostedPlaceName", "Ana's render box");
    expect((await visitorStatus(auth.accountById(accountId)!)).viewer.placeName).toBe("Ana's render box");
    expect((await visitorStatus(null)).viewer.placeName).toBe("Ana's render box");
  });
  it("with a billing service: its policy's name wins; none while its policy closes hosted runs", async () => {
    process.env.FUOBE_HOSTED_RUNS = "1";
    process.env.FUOBE_BILLING_URL = fake.url;
    process.env.FUOBE_BILLING_TOKEN = "test-billing-token";
    settings.setSetting("hostedPlaceName", "Ana's render box");
    fake.policy = { ...FAKE_POLICY, placeName: "Studio North GPUs" };
    expect((await visitorStatus(auth.accountById(accountId)!)).viewer.placeName).toBe("Studio North GPUs");
    billing.resetBillingCache();
    fake.policy = { ...FAKE_POLICY };
    expect((await visitorStatus(auth.accountById(accountId)!)).viewer.placeName).toBe("Ana's render box");
    billing.resetBillingCache();
    fake.policy = { ...FAKE_POLICY, hosted: false, placeName: "Studio North GPUs" };
    expect((await visitorStatus(auth.accountById(accountId)!)).viewer).not.toHaveProperty("placeName");
  });
});

describe("the page's place name", () => {
  const read = (viewer: object | undefined) => {
    const client = new QueryClient();
    if (viewer) client.setQueryData(["status"], { providers: {}, demoMode: "off", engineMode: "both", cloudProvider: "auto", viewer });
    let seen: unknown = "unset";
    const Probe = () => {
      seen = usePlaceName();
      return null;
    };
    renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(Probe)));
    return seen;
  };
  it("none for the owner and while hosted runs are off; the name (or Our GPUs) while they are on", () => {
    expect(read(undefined)).toBeNull();
    expect(read({ kind: "account", gpu: { connected: false }, placeName: "Ignored" })).toBeNull();
    expect(read({ kind: "account", gpu: { connected: false }, hosted: true })).toEqual({ label: "Our GPUs", text: "our GPUs" });
    expect(read({ kind: "guest", gpu: { connected: false }, hosted: true, placeName: "Ana's render box" })).toEqual({ label: "Ana's render box", text: "Ana's render box" });
  });
});
