import { keyName, type OwnSetup } from "./own-setup";
import type { Place } from "./place-name";

/**
 * The card a press on a labelled item opens while hosted runs are on (an item this install's GPUs don't run: "Runs on
 * your own GPU · 48 GB", "Use your own fal.ai key"): what it needs, and the way there. A guest reads how signing up
 * leads there, never that the run starts once signed in (nothing can start before the GPU or key exists); an account
 * reads how connecting its GPU runs it. Both read that everything else runs on the place (`place`: the name visitors
 * read for this install's GPUs). Pure: tests/own-setup-card.test.ts.
 */

/** What a GPU item needs, as a sentence's object: "a GPU with 48 GB of memory", "a Linux computer with …". */
function gpuNeed(o: Extract<OwnSetup, { need: "gpu" }>): string {
  const card = o.vramGb ? `a GPU with ${o.vramGb} GB of memory` : "a GPU of your own";
  return o.linux ? `a Linux computer with ${card}` : card;
}

export function setupCardWords(o: OwnSetup, place: Place | null, who: "guest" | "account"): { title: string; body: string } {
  const rest = place ? ` Everything else runs on ${place.text}.` : "";
  if (o.need === "key") {
    const name = keyName(o.provider);
    return who === "guest"
      ? { title: `This one runs with your own ${name} key`, body: `Sign up free, then add your key. ${name} bills your runs to your account with them.${rest}` }
      : { title: `This one runs with your own ${name} key`, body: `Add your key, and this runs with it. ${name} bills your runs to your account with them.${rest}` };
  }
  const orKey = o.orKey ? ` Or use your own ${keyName(o.orKey)} key.` : "";
  return who === "guest"
    ? { title: "This one runs on your own GPU", body: `It needs ${gpuNeed(o)}. Sign up free, then connect yours in a few steps.${rest}${orKey}` }
    : { title: "This one runs on your own GPU", body: `It needs ${gpuNeed(o)}. Connect yours, and this runs there.${rest}${orKey}` };
}

/**
 * The guest card's words for a run a studio kept through sign-up (an item this install's GPUs run): it starts as soon as
 * the guest is in. Said only for such a run.
 */
export const KEPT_RUN_WORDS = "Sign up with an email and a password. Your run starts as soon as you're in.";
