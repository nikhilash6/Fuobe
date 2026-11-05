import { afterEach, describe, expect, it, vi } from "vitest";

// A run refused for a changed price, or offered on this studio's GPUs because the account's own GPU didn't answer, is
// sent again as it was first sent, from any page (a result's Upscale, a retry, a tool), with the new price shown or the
// place asked for in its headers.

const toasts = vi.hoisted(() => ({ shown: [] as { message: string; action?: { label: string; onClick: () => void } }[] }));
vi.mock("sonner", () => ({
  toast: Object.assign((message: string, o?: { action?: { label: string; onClick: () => void } }) => void toasts.shown.push({ message, action: o?.action }), { error: () => {}, warning: () => {} }),
}));

import { sendRunAgain, watchGuestRefusals } from "@/lib/api";
import { PLACE_ASK_HEADER, RUN_PLACE_HEADER, RUN_SHOWN_HEADER, RUNS_CHANGED_EVENT } from "@/lib/guest-access";
import { BILLING_EVENT, BILLING_HEADER, type BillingRefusalDetail } from "@/lib/hosted";

const answer = (status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const sent: { url: string; init?: RequestInit }[] = [];
const events: { type: string; detail: unknown }[] = [];
let server: (url: string, init?: RequestInit) => Response = () => answer(201, {});

function page() {
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("location", { pathname: "/apps/influencer", search: "", href: "http://localhost/apps/influencer" });
  vi.stubGlobal("dispatchEvent", (e: Event) => void events.push({ type: e.type, detail: (e as CustomEvent).detail ?? null }));
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? new URL(input.url).pathname : String(input);
    sent.push({ url, init });
    return server(url, init);
  });
  (globalThis as { __fuobeGuestFetch?: boolean }).__fuobeGuestFetch = false;
  watchGuestRefusals();
}

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
  events.length = 0;
  toasts.shown.length = 0;
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("a changed price", () => {
  it("the card can send the same run again at the new price, whatever tool sent it", async () => {
    page();
    const quote = { allowed: true, amount: 9, priceVersion: "v9", text: "9 units" };
    server = (url, init) => (new Headers(init?.headers).get(RUN_SHOWN_HEADER) ? answer(201, { items: [] }) : answer(409, { error: "The price is now 9 units.", quote }, { [BILLING_HEADER]: "price-changed" }));
    const body = JSON.stringify({ engine: "open", state: {} });
    const r = await window.fetch("/api/influencer", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect(r.status).toBe(409);
    await settle();
    const card = events.find((e) => e.type === BILLING_EVENT)?.detail as BillingRefusalDetail;
    expect(card.code).toBe("price-changed");
    expect(card.runAgain).toBeTypeOf("function");
    expect(await card.runAgain!()).toBe(true);
    const again = sent.at(-1)!;
    expect(again.url).toBe("/api/influencer");
    expect(again.init?.body).toBe(body);
    expect(JSON.parse(decodeURIComponent(new Headers(again.init?.headers).get(RUN_SHOWN_HEADER)!))).toEqual({ amount: 9, priceVersion: "v9" });
    expect(new Headers(again.init?.headers).get("content-type")).toBe("application/json");
    expect(events.some((e) => e.type === RUNS_CHANGED_EVENT)).toBe(true);
  });

  it("any other refusal, or a body that can't be sent twice, offers nothing to send again", async () => {
    page();
    server = () => answer(402, { error: "Not enough." }, { [BILLING_HEADER]: "balance" });
    await window.fetch("/api/influencer", { method: "POST", body: "{}" });
    await settle();
    expect((events.find((e) => e.type === BILLING_EVENT)?.detail as BillingRefusalDetail).runAgain).toBeUndefined();
    events.length = 0;
    server = () => answer(409, { error: "Now 9.", quote: { allowed: true, amount: 9, priceVersion: "v9", text: "9" } }, { [BILLING_HEADER]: "price-changed" });
    await window.fetch("/api/uploads", { method: "POST", body: new Blob(["x"]) });
    await settle();
    expect((events.find((e) => e.type === BILLING_EVENT)?.detail as BillingRefusalDetail).runAgain).toBeUndefined();
  });
});

describe("an account's own GPU that didn't answer", () => {
  it("a tool's run is offered on this studio's GPUs and sent again with that place in a header", async () => {
    page();
    server = (url, init) => (new Headers(init?.headers).get(RUN_PLACE_HEADER) === "pool" ? answer(201, {}) : answer(409, { error: "Your GPU isn't answering right now." }, { [PLACE_ASK_HEADER]: "1" }));
    await window.fetch("/api/turnaround", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await settle();
    const offer = toasts.shown.at(-1)!;
    expect(offer.action?.label).toBe("Run on Our GPUs");
    offer.action!.onClick();
    await settle();
    await settle();
    expect(sent.at(-1)!.url).toBe("/api/turnaround");
    expect(new Headers(sent.at(-1)!.init?.headers).get(RUN_PLACE_HEADER)).toBe("pool");
  });

  it("the offer says the place by the name the server gave", async () => {
    page();
    server = () => answer(409, { error: "Your GPU isn't answering right now.", placeName: "Ana's render box" }, { [PLACE_ASK_HEADER]: "1" });
    await window.fetch("/api/turnaround", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await settle();
    expect(toasts.shown.at(-1)!.action?.label).toBe("Run on Ana's render box");
  });

  it("sendRunAgain says when the run still didn't start", async () => {
    page();
    server = () => answer(500, { error: "Something went wrong" });
    expect(await sendRunAgain("/api/turnaround", { method: "POST", body: "{}" }, { [RUN_PLACE_HEADER]: "pool" })).toBe(false);
  });
});
