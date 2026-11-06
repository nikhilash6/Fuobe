/**
 * The next step as the panel's "Stuck?" says it to the person (their AI gets the full next step with "Copy for my AI"):
 * what Fuobe sees, in the person's own terms, with no guide steps, commands or flags. Pure.
 */
import type { NextStep } from "./next-step";

const WORDS: Record<string, string> = {
  "wake-fuobe": "Fuobe can check only while this tab is open.",
  "open-fuobe": "Fuobe can check only while this tab is open.",
  done: "All done. Fuobe uses your GPU now.",
  "use-address": "This browser can't reach ComfyUI on your computer. A web address works instead.",
  "allow-browser": "Fuobe hasn't looked for ComfyUI yet. If ComfyUI runs, press Let Fuobe look. If you don't have it yet, your AI installs it first.",
  "unblock-browser": "Your browser stops Fuobe from reaching apps on this computer. Allow it next to the address bar, then reload.",
  "start-comfyui": "Fuobe doesn't see ComfyUI on this computer. Start ComfyUI, or ask your AI to install it.",
  "wrong-app": "Another app answers on that port, not ComfyUI.",
  restarting: "ComfyUI is starting again, or it was closed. A portable ComfyUI can take up to 5 minutes to start.",
  "not-back": "ComfyUI stopped a few minutes ago and hasn't come back. Look at its window for an error, or start it again.",
  "install-connect": "Fuobe Connect isn't in ComfyUI yet. Your AI installs it next.",
  "connect-not-loaded": "ComfyUI restarted, but it didn't load Fuobe Connect. Your AI checks the folder and ComfyUI's window.",
  pair: "Once Fuobe Connect is in ComfyUI, open Extensions, then Connect to Fuobe, in ComfyUI. Type the code it shows here.",
  connecting: "Fuobe sees ComfyUI and is connecting. It takes a few seconds.",
  "setting-not-taken": "ComfyUI restarted, but it still doesn't let Fuobe in. Your AI checks the setting.",
  "add-setting": "ComfyUI runs, but it doesn't let Fuobe in yet. Your AI adds Fuobe's setting next.",
  "remove-listen": "ComfyUI is open to other computers on your network. Your AI turns that off.",
  "fix-any": "ComfyUI lets every website in. Your AI changes that to Fuobe only.",
  "fix-setting": "ComfyUI lets another website in, not Fuobe. Your AI changes the setting.",
  "add-guard": "Fuobe's guard isn't in ComfyUI yet. It keeps other websites out. Your AI adds it next.",
  "address-testing": "Fuobe is testing your web address.",
  "checking-link": "Fuobe is checking your web address.",
  "link-offline": "Fuobe can't reach ComfyUI at your web address. If the cloudflared window closed, your AI starts it again and you paste the new address.",
  "start-tunnel": "Fuobe doesn't have your ComfyUI's web address yet. Your AI makes one with cloudflared.",
  "address-local": "That address works only on your own network. Paste the one that ends in trycloudflare.com.",
  "address-not-found": "Fuobe can't find that address. Paste all of it, and keep the cloudflared window open.",
  "address-no-answer": "Nothing answers at that address. Keep ComfyUI and the cloudflared window open.",
  "address-not-comfy": "That address doesn't lead to ComfyUI.",
  "address-password": "Your web address asks for a password or a token. Type it under Access token, then press Connect.",
  "checking-models": "Fuobe is checking which models ComfyUI has.",
  "get-model": "ComfyUI needs a picture model. Your AI can download it, after you say yes.",
  "cpu-only": "ComfyUI runs on your computer's processor, not on a graphics card, so no picture model fits. If the computer has a graphics card, your AI can make ComfyUI use it.",
  "model-setup": "These picture models need more than a download on your ComfyUI, most often an update. Your AI can update it.",
  "no-model-fits": "Your GPU has too little memory for the small picture models. Your own fal.ai or Replicate key works instead.",
  "make-picture": "All set. Press Make your first picture.",
  "picture-running": "Fuobe is making your first picture.",
  "picture-failed": "The first picture didn't finish. Try again.",
};

export function personWords(next: Pick<NextStep, "id">): string {
  return WORDS[next.id] ?? (next.id.startsWith("address-") ? "Fuobe couldn't use that web address. Read what Fuobe says under the box." : "Fuobe is waiting for the next step.");
}
