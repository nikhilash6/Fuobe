import { describe, expect, it } from "vitest";
import { boardRunWords } from "@/lib/board-run-words";
import { OWN_GPU_TOOL_HOSTED, OWN_GPU_TOOL_MESSAGE, ownGpuToolMessage } from "@/lib/guest-access";
import { KEPT_RUN_WORDS, setupCardWords } from "@/lib/own-setup-card";
import { answerPickModel, canPickModel, pickAnotherModel } from "@/lib/pick-model";
import { placeOf } from "@/lib/place-name";
import { openCheckPlace, openFreeWords, runPlace } from "@/lib/run-place";

/*
 * What the site's GPUs can't run is a label, never a refusal (hosted runs on): the card a press on a labelled item opens
 * says what it needs and the way there, for a guest and an account, with "Pick another model" one press away; the
 * surfaces that don't run here yet point at the studios. With hosted runs off every word stays as it was.
 */

const PLACE = placeOf("Studio North GPUs");

describe("the card a labelled item opens", () => {
  const gpu48 = { need: "gpu" as const, vramGb: 48 };

  it("a guest reads how signing up leads there, never that the run starts once in", () => {
    const g = setupCardWords(gpu48, PLACE, "guest");
    expect(g).toEqual({
      title: "This one runs on your own GPU",
      body: "It needs a GPU with 48 GB of memory. Sign up free, then connect yours in a few steps. Everything else runs on Studio North GPUs.",
    });
    expect(g.body).not.toContain("as soon as you're in");
    const key = setupCardWords({ need: "key", provider: "fal" }, PLACE, "guest");
    expect(key.title).toBe("This one runs with your own fal.ai key");
    expect(key.body).toBe("Sign up free, then add your key. fal.ai bills your runs to your account with them. Everything else runs on Studio North GPUs.");
  });

  it("an account reads how connecting its GPU runs it; a Linux card and a key that runs it too are said", () => {
    expect(setupCardWords(gpu48, PLACE, "account").body).toBe("It needs a GPU with 48 GB of memory. Connect yours, and this runs there. Everything else runs on Studio North GPUs.");
    expect(setupCardWords({ need: "gpu", vramGb: 24, linux: true, orKey: "fal" }, PLACE, "account").body).toBe(
      "It needs a Linux computer with a GPU with 24 GB of memory. Connect yours, and this runs there. Everything else runs on Studio North GPUs. Or use your own fal.ai key.",
    );
    // No place known: nothing said about where everything else runs.
    expect(setupCardWords({ need: "gpu" }, null, "account").body).toBe("It needs a GPU of your own. Connect yours, and this runs there.");
  });

  it("the promise that a run starts once signed in is its own words, for a run the site takes", () => {
    expect(KEPT_RUN_WORDS).toBe("Sign up with an email and a password. Your run starts as soon as you're in.");
  });
});

describe("Pick another model", () => {
  it("opens the last model picker shown, and is offered only while one is", () => {
    expect(canPickModel()).toBe(false);
    expect(pickAnotherModel()).toBe(false);
    const opened: string[] = [];
    const stopA = answerPickModel(() => opened.push("a"));
    const stopB = answerPickModel(() => opened.push("b"));
    expect(canPickModel()).toBe(true);
    expect(pickAnotherModel()).toBe(true);
    expect(opened).toEqual(["b"]);
    stopB();
    expect(pickAnotherModel()).toBe(true);
    expect(opened).toEqual(["b", "a"]);
    stopA();
    expect(canPickModel()).toBe(false);
  });
});

describe("the surfaces that don't run here yet", () => {
  it("a board's Run points at the studio that makes it, by the place name; with hosted runs off, today's words", () => {
    expect(boardRunWords(true, PLACE)).toEqual({
      title: "Make this in the Video studio",
      body: "You can build, change and keep boards here. The same effect in the Video studio runs every step at once, on Studio North GPUs.",
    });
    expect(boardRunWords(false, PLACE).title).toBe("Make it in a studio");
    expect(boardRunWords(true, null).title).toBe("Running a board isn't available here");
    expect(boardRunWords(false, null).body).toBe("You can build, change and keep boards here. To make something now, use the Image, Video or Audio studio, or an app, effect or camera motion.");
  });

  it("a tool for the studio's owner only: coming soon, with the studios to use now; with hosted runs off, as before", () => {
    const hosted = runPlace({ audience: "account", engine: "cloud", hosted: true, ownerOnly: "Ad Multiplier", format: String });
    expect(hosted).toMatchObject({ where: "unavailable", label: "Coming soon", title: "Coming soon", price: "", send: "", tip: "Ad Multiplier isn't open to accounts yet. Try the Image, Video or Audio studio." });
    const off = runPlace({ audience: "guest", engine: "cloud", ownerOnly: "Ad Multiplier", format: String });
    expect(off).toMatchObject({ label: "Not available here", tip: "Ad Multiplier isn't available here. Try the Image, Video or Audio studio." });
    // A press that leads on: the studio that makes it now (the Image studio unless the tool names another).
    expect(hosted.way).toEqual({ label: "Make it in the Image studio", href: "/image" });
    expect(runPlace({ audience: "account", engine: "cloud", hosted: true, ownerOnly: "Ad Multiplier", ownerOnlyStudio: "video", format: String }).way).toEqual({ label: "Make it in the Video studio", href: "/video" });
    expect(off.way).toBeUndefined();
    // The owner runs it as always.
    expect(runPlace({ audience: "owner", engine: "cloud", hosted: true, ownerOnly: "Ad Multiplier", format: String }).where).toBe("cloud");
  });

  it("a tool no visitor's own GPU or key runs yet: no 'isn't available here' while hosted runs are on", () => {
    expect(ownGpuToolMessage(false)).toBe(OWN_GPU_TOOL_MESSAGE);
    expect(ownGpuToolMessage(true)).toBe(OWN_GPU_TOOL_HOSTED);
    expect(OWN_GPU_TOOL_HOSTED).not.toMatch(/isn't available here/);
  });
});

describe("a tool page's free words (4.7)", () => {
  const site = (v: Parameters<typeof openCheckPlace>[0]) => openCheckPlace(v) !== null;
  const account = { audience: "account" as const, gpu: false, hosted: true, preferPool: true };

  it("an open run that goes to the site's GPUs is just Free: the page's place chip or price check says where", () => {
    expect(openFreeWords("Free · your GPU", true)).toBe("Free");
    expect(openFreeWords("Free on your GPU", true)).toBe("Free");
    expect(openFreeWords("Free · on your GPU, about 20 GB", true)).toBe("Free");
    expect(openFreeWords("Free · GPU", true)).toBe("Free");
    expect(openFreeWords(" · free on your GPU", true)).toBe(" · free");
    expect(openFreeWords("Free on your GPU · about 4 min", true)).toBe("Free · about 4 min");
    // Prices and other words stay.
    expect(openFreeWords("≈ $0.38", true)).toBe("≈ $0.38");
    expect(openFreeWords("Placeholder · free", true)).toBe("Placeholder · free");
  });

  it("runs on the person's own GPU, the owner's, and every install with hosted runs off keep the page's words", () => {
    expect(openFreeWords("Free · your GPU", false)).toBe("Free · your GPU");
    expect(site(account)).toBe(true);
    expect(site({ ...account, gpu: true })).toBe(true);
    expect(site({ ...account, gpu: true, runOn: "gpu" })).toBe(false);
    expect(site({ ...account, gpu: true, preferPool: false })).toBe(false);
    expect(site({ ...account, gpu: true, preferPool: false, runOn: "site" })).toBe(true);
    expect(site({ ...account, audience: "owner" })).toBe(false);
    expect(site({ ...account, hosted: false })).toBe(false);
    expect(site(null)).toBe(false);
  });
});
