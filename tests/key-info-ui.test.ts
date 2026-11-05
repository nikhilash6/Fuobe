import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { KeyAccountDetails, NoKeyYet } from "@/components/keys/key-account-details";
import { keyInfoKey } from "@/components/keys/use-key-info";
import { accountWords, menuLabel, menuValue, money, savedProviders, updatedWords, type KeyInfoStatus, type ProviderAccount } from "@/lib/key-info";

/*
 * Connected accounts in the page (src/lib/key-info.ts, src/components/keys/key-account-details.tsx,
 * src/components/nav/connected-accounts.tsx): who gets rows, what each row says, and what Settings shows for each
 * answer. Plain, positive words: a missing figure is left out and the billing page is always a link away.
 */

const status = (s: Partial<KeyInfoStatus>): KeyInfoStatus => ({ providers: {}, ...s });
const fal = (more: Partial<ProviderAccount>): ProviderAccount => ({ provider: "fal", checkedAt: Date.now(), state: "link", billingUrl: "https://fal.ai/dashboard/billing", ...more });
const rep = (more: Partial<ProviderAccount>): ProviderAccount => ({ provider: "replicate", checkedAt: Date.now(), state: "link", billingUrl: "https://replicate.com/account/billing", ...more });

/** The markup of a Settings card's details, with this answer from /api/key-info already in hand. */
function details(answer: ProviderAccount[] | null, props: Partial<Parameters<typeof KeyAccountDetails>[0]> = {}) {
  const client = new QueryClient();
  if (answer) client.setQueryData(keyInfoKey(true), { providers: answer });
  const node: ReactNode = createElement(KeyAccountDetails, { provider: "fal", scope: "owner", ...props });
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, node));
}
const words = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").replaceAll("&#x27;", "'").trim();
const NEVER = /unavailable|unknown|not checked|error|failed|undefined|NaN/i;

describe("who gets Connected accounts", () => {
  it("the owner: the studio's saved keys, fal.ai first; nothing in Open source only", () => {
    expect(savedProviders("owner", status({ providers: { replicate: { configured: true }, fal: { configured: true } } }), "both")).toEqual(["fal", "replicate"]);
    expect(savedProviders("owner", status({ providers: { fal: { configured: false }, replicate: { configured: true } } }), "cloud")).toEqual(["replicate"]);
    // No key: no rows (the status row already says "add key").
    expect(savedProviders("owner", status({ providers: { fal: { configured: false } } }), "both")).toEqual([]);
    expect(savedProviders("owner", status({ providers: { fal: { configured: true } } }), "open")).toBeNull();
  });

  it("an account: its own keys only, [] (Add a key) with none, nothing when paid models are off", () => {
    expect(savedProviders("account", status({ providers: { fal: { configured: true } }, viewer: { kind: "account", keys: ["replicate"] } }), "both")).toEqual(["replicate"]);
    expect(savedProviders("account", status({ viewer: { kind: "account", keys: [] } }), "open")).toEqual([]);
    expect(savedProviders("account", status({ viewer: { kind: "account" } }), "open")).toEqual([]);
    expect(savedProviders("account", status({ viewer: { kind: "account", keys: ["fal"], paidAllowed: false } }), "open")).toBeNull();
  });

  it("a guest, and anyone while the status is unknown: nothing, so nothing is asked", () => {
    expect(savedProviders("guest", status({ viewer: { kind: "guest", keys: [] } }), "open")).toBeNull();
    expect(savedProviders(undefined, status({}), "both")).toBeNull();
    expect(savedProviders("owner", undefined, "both")).toBeNull();
    // The owner's kind with a visitor's status (a page mid-change): nothing.
    expect(savedProviders("owner", status({ providers: { fal: { configured: true } }, viewer: { kind: "account", keys: ["fal"] } }), "both")).toBeNull();
  });
});

describe("the menu's rows", () => {
  it("say the balance, an empty balance, the billing link or the key to check", () => {
    expect(menuValue(fal({ state: "ok", balance: { amount: 24.5, currency: "USD" } }))).toEqual({ text: "$24.50", kind: "amount" });
    expect(menuValue(fal({ state: "empty", balance: { amount: 0, currency: "USD" } }))).toEqual({ text: "$0.00 · Top up", kind: "empty" });
    expect(menuValue(rep({ state: "empty" }))).toEqual({ text: "Top up", kind: "empty" });
    expect(menuValue(fal({ state: "link" }))).toEqual({ text: "See balance", kind: "link" });
    expect(menuValue(rep({ state: "link", account: { name: "alice" } }))).toEqual({ text: "See balance", kind: "link" });
    expect(menuValue(fal({ state: "check-key" }))).toEqual({ text: "Check key", kind: "fix" });
    // No answer (it failed, or the key isn't in it): the billing link, never an error.
    expect(menuValue(undefined)).toEqual({ text: "See balance", kind: "link" });
  });

  it("name each row for a screen reader, with where it goes", () => {
    expect(menuLabel("replicate", rep({}))).toBe("See your Replicate balance on Replicate (opens in a new tab)");
    expect(menuLabel("fal", fal({ state: "ok", balance: { amount: 24.5, currency: "USD" } }))).toBe("fal.ai balance $24.50. Opens fal.ai billing in a new tab");
    expect(menuLabel("fal", fal({ state: "check-key" }))).toBe("fal.ai: check your key in Settings");
  });

  it("format money in the reader's way, and a code Intl can't format plainly", () => {
    expect(money({ amount: 24.5, currency: "USD" }, "en-US")).toBe("$24.50");
    expect(money({ amount: 24.5, currency: "USD" }, "en-GB")).toBe("$24.50");
    expect(money({ amount: 110, currency: "CNY" }, "en-US")).toBe("¥110.00");
    expect(money({ amount: 3, currency: "ZZZZ" }, "en-US")).toBe("3.00 ZZZZ");
  });

  it("say how old the answer is, and whose account it is", () => {
    expect(updatedWords(1_000, 1_000 + 59_000)).toBe("Updated just now");
    expect(updatedWords(0, 4 * 60_000 + 5_000)).toBe("Updated 4 min ago");
    expect(updatedWords(0, 2 * 3_600_000 + 1)).toBe("Updated 2 h ago");
    expect(accountWords({ name: "alice", kind: "user", fullName: "Alice" })).toBe("alice (Alice)");
    expect(accountWords({ name: "acme", kind: "organization", fullName: "Acme Corp, Inc." })).toBe("acme (organization)");
    expect(accountWords({ name: "my-team" })).toBe("my-team");
  });
});

describe("Settings: a saved key's account", () => {
  it("fal.ai with the balance: balance, account, this month's spend and the billing page", () => {
    const html = details([fal({ state: "ok", balance: { amount: 24.5, currency: "USD" }, account: { name: "my-team" }, spentThisMonth: { amount: 3.2, currency: "USD" } })]);
    const w = words(html);
    expect(w).toContain("Balance $24.50");
    expect(w).toContain("Account my-team");
    expect(w).toContain("Spent this month $3.20");
    expect(w).toContain("Open fal.ai billing");
    expect(w).toContain("Updated just now");
    expect(w).toContain("Refresh");
    expect(html).toContain('href="https://fal.ai/dashboard/billing" target="_blank" rel="noreferrer"');
    expect(w).not.toMatch(NEVER);
  });

  it("fal.ai without balance access: the billing link, and how to show the balance here", () => {
    const w = words(details([fal({ state: "link" })]));
    expect(w).toContain("fal.ai shows your balance on its billing page. See balance on fal.ai");
    expect(w).toContain("Show the balance here");
    expect(w).toContain("billing:usage:read");
    expect(w).not.toMatch(NEVER);
  });

  it("an empty balance says to top up", () => {
    expect(words(details([fal({ state: "empty", balance: { amount: 0, currency: "USD" } })]))).toContain("Balance $0.00 Your fal.ai balance is empty. Top up on fal.ai");
    expect(words(details([rep({ state: "empty" })], { provider: "replicate" }))).toContain("Your Replicate balance is empty. Top up on Replicate");
    // Your keys already says the balance ran out ("Add credit"): the figure stays, the sentence isn't said twice.
    const noted = words(details([fal({ state: "empty", balance: { amount: 0, currency: "USD" } })], { scope: "account", emptyNoted: true }));
    expect(noted).toContain("Balance $0.00");
    expect(noted).not.toContain("is empty");
    expect(words(details([rep({ state: "empty" })], { provider: "replicate", scope: "account", emptyNoted: true }))).toBe("");
  });

  it("Replicate: the account and the billing link (Replicate has no balance to read)", () => {
    const w = words(details([rep({ account: { name: "acme", kind: "organization", fullName: "Acme Corp, Inc." } })], { provider: "replicate" }));
    expect(w).toContain("Account acme (organization)");
    expect(w).toContain("Replicate shows your balance on its billing page. See balance on Replicate");
    expect(w).not.toContain("Show the balance here");
    expect(w).not.toMatch(NEVER);
  });

  it("a key the provider didn't accept: what to do, unless the card already says so", () => {
    expect(words(details([fal({ state: "check-key" })]))).toBe("fal.ai didn't accept this key. Press Test to check it, or save a new one.");
    expect(words(details([rep({ state: "check-key" })], { provider: "replicate", scope: "account" }))).toBe("Replicate didn't accept this token. Press Check again, or replace it.");
    expect(words(details([fal({ state: "check-key" })], { scope: "account", refused: true }))).toBe("");
  });

  it("waits quietly before the card is seen, and falls back to the billing link with no answer", () => {
    const waiting = details(null);
    expect(words(waiting)).toBe("");
    expect(waiting).toContain('aria-busy="true"');
    // The answer came without this provider (a key removed meanwhile): the link, no figures.
    expect(words(details([rep({})]))).toContain("See balance on fal.ai");
  });

  it("a card with no key yet says what will show there", () => {
    expect(words(renderToStaticMarkup(createElement(NoKeyYet, { provider: "fal" })))).toBe("When you save a key, this card shows your fal.ai balance or a link to it.");
    expect(words(renderToStaticMarkup(createElement(NoKeyYet, { provider: "replicate" })))).toBe(
      "When you save a token, this card shows your Replicate account and a link to your balance.",
    );
  });
});
