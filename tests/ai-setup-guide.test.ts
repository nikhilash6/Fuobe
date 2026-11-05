import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { guideText, withCode, type GuideModel } from "@/lib/ai-setup/guide";
import { agentLine, agentText, AI_TARGETS, chatLink, fullInstructions, LINK_MAX, PREFILL_MAX, prefillText } from "@/lib/ai-setup/handoff";
import { MODEL_STEP } from "@/lib/ai-setup/next-step";
import { OSES, type Os, type Way } from "@/lib/ai-setup/ways";
import { GUARD_SHA256, GUARD_SOURCE } from "@/lib/comfy-guard";
import { LIVE_NODES_SHA256, LIVE_NODES_SOURCE } from "@/lib/comfy-live-nodes";

/**
 * "Set it up with my AI": the steps an AI follows and the hand-offs that carry them. Every guide is ASCII, names only
 * --enable-cors-header <this site>, keeps the safety rules, checks Fuobe's files by their SHA-256, and its Windows
 * commands run the same from PowerShell and through powershell.exe -Command (no $, no braces).
 */
const SITE = "https://fuobe.com";
const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const MODELS: GuideModel[] = [
  { name: "Z-Image Turbo", fits: "for a GPU with 12 GB or more", files: [{ file: "z_image_turbo_bf16.safetensors", folder: "diffusion_models", url: "https://huggingface.co/x/resolve/main/z.safetensors", sizeGb: 12.31 }] },
  { name: "SDXL", fits: "for a GPU with 8 GB or more", files: [{ file: "sd_xl_base_1.0.safetensors", folder: "checkpoints", url: "https://huggingface.co/y/resolve/main/s.safetensors?download=true", sizeGb: 6.94 }] },
];
const WAYS: Way[] = ["direct", "address", "connect"];
const guides = WAYS.flatMap((way) => OSES.map((os) => ({ way, os, text: guideText({ way, os, site: SITE, models: MODELS }) })));
const commands = (text: string) => text.split("\n").filter((l) => /^ {3}\S/.test(l));

describe("the guide", () => {
  it("checks Fuobe's files by the hash of the very files Fuobe serves", () => {
    expect(GUARD_SHA256).toBe(sha(GUARD_SOURCE));
    expect(LIVE_NODES_SHA256).toBe(sha(LIVE_NODES_SOURCE));
    for (const g of guides.filter((g) => g.way === "direct" && g.os !== "other")) {
      expect(g.text).toContain(GUARD_SHA256);
      expect(g.text).toContain(LIVE_NODES_SHA256);
      expect(g.text).toContain(`${SITE}/api/setup/files/fuobe_guard.py`);
    }
  });

  it("is ASCII, and every command names only this site's setting", () => {
    for (const g of guides) {
      expect(g.text, `${g.way}/${g.os}`).toMatch(/^[\x09\x0a\x20-\x7e]*$/);
      for (const line of g.text.split("\n")) {
        if (!line.includes("--enable-cors-header")) continue;
        // The only lines that name the setting without this site: the rules that forbid it.
        if (/^\d\. (Never use --enable-cors-header \*|This way needs no new ComfyUI setting)/.test(line)) continue;
        expect(line, `${g.way}/${g.os}`).toMatch(new RegExp(`--enable-cors-header ${SITE.replace(/[.]/g, "[.]")}(\\s|$)`));
      }
    }
    const direct = guides.filter((g) => g.way === "direct" && g.os !== "other");
    for (const g of direct) expect(g.text).toContain(`2. Use exactly this setting: --enable-cors-header ${SITE}`);
  });

  it("keeps the safety rules: ask first, no --listen, no open ports, the address is a key", () => {
    for (const g of guides.filter((g) => g.os !== "other")) {
      expect(g.text).toContain("Before each command, show it and say in one line what it does. Wait for the person to say yes.");
      expect(g.text).toContain("Do not open ports in a firewall or a router.");
      expect(g.text).toContain("Never use --listen.");
      // --listen appears only in its rule.
      expect(g.text.split("\n").filter((l) => l.includes("--listen")).every((l) => /Never use --listen/.test(l))).toBe(true);
      expect(g.text).toContain("Use the setup code only with the status address.");
    }
    for (const g of guides.filter((g) => g.way === "address" && g.os !== "other")) {
      expect(g.text).toContain("The web address works like a key.");
      expect(g.text).toContain("Do not run cloudflared login");
      // The address is never printed or tested from the agent: it goes to the clipboard.
      expect(g.text).toMatch(/Set-Clipboard|pbcopy|xclip/);
      expect(g.text).not.toMatch(/<address>\/system_stats/);
      expect(g.text).toMatch(/Stop-Process -Id \(Get-Content ~\\\.fuobe\\tunnel\.pid\)|pkill -f \.fuobe\/tunnel\.log/);
      // Only this tunnel: never every cloudflared the person runs.
      expect(g.text).not.toMatch(/Stop-Process -Name cloudflared|pkill -f "cloudflared tunnel --url"/);
      // An old log can't give a dead address.
      expect(g.text).toMatch(/Get-ChildItem ~\\\.fuobe -Filter tunnel\.log \| Remove-Item|rm -f ~\/\.fuobe\/tunnel\.log/);
    }
  });

  it("keeps a web address visible, private and short-lived, and warns about ComfyUI-Manager", () => {
    for (const g of guides.filter((g) => g.way === "address" && g.os !== "other")) {
      // Never a tunnel hidden in the background, nor a log other users of the computer can read.
      expect(g.text).not.toMatch(/nohup|\/tmp\//);
      expect(g.text).toContain("ComfyUI-Manager");
      expect(g.text).toContain("Closing it stops the address.");
      expect(g.text).toMatch(/they close the tunnel's window/);
      // The tunnel's log goes in the person's own user folder, which other users of the computer can't read.
      if (g.os !== "windows") expect(g.text).toContain("mkdir -p -m 700 ~/.fuobe");
      else {
        expect(g.text).toContain("New-Item -ItemType Directory -Force ~\\.fuobe | Out-Null");
        expect(g.text).toContain('Start-Process cloudflared -WorkingDirectory ~\\.fuobe -ArgumentList "tunnel","--url","http://127.0.0.1:8188","--logfile","tunnel.log"');
        expect(g.text).toContain("Select-String -Path ~\\.fuobe\\tunnel.log");
        expect(g.text).not.toMatch(/fuobe-tunnel|in this folder/);
      }
      // The models folder the model step names is found first.
      expect(g.text).toContain("Common places for custom_nodes:");
      expect(g.text).toContain("The models folder is next to custom_nodes");
      // The address goes into Fuobe on the computer, even when Fuobe was opened on a phone.
      expect(g.text).toContain(`${SITE}/connect?setup=ai&way=address in a browser on this computer, and signs in with the same account.`);
      expect(g.text).toContain("with the same setup code");
    }
    const mac = guides.find((x) => x.way === "address" && x.os === "mac")!.text;
    expect(mac).toContain(`osascript -e 'tell application "Terminal" to do script "cloudflared tunnel --url http://127.0.0.1:8188 --logfile ~/.fuobe/tunnel.log"'`);
    const win = guides.find((x) => x.way === "address" && x.os === "windows")!.text;
    expect(win).toContain("Get-NetTCPConnection -LocalPort 8188 -State Listen");
  });

  it("Windows commands have no $ and no braces, so they also run through powershell.exe -Command", () => {
    for (const g of guides.filter((g) => g.os === "windows")) {
      for (const line of commands(g.text)) {
        if (!/^ {3}(curl\.exe|Get-|New-Item|Start-Process|Select-String|Remove-Item|Stop-Process|Expand-Archive|Rename-Item|certutil|winget|cloudflared|git )/.test(line)) continue;
        expect(line.replace("%{http_code}", ""), line).not.toMatch(/[$`{}]/);
      }
      expect(g.text).toContain("winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements".repeat(g.way === "address" ? 1 : 0));
      expect(g.text).toContain("powershell.exe -NoProfile -Command");
    }
  });

  it("finds ComfyUI by its port on Windows, and starts a portable one with Fuobe's start file", () => {
    const g = guides.find((x) => x.way === "direct" && x.os === "windows")!.text;
    expect(g).toContain("Get-NetTCPConnection -LocalPort 8188 -State Listen | Select-Object -ExpandProperty OwningProcess");
    expect(g).toContain(`${SITE}/api/setup/files/start/8188`);
    expect(g).toContain("ask the person to answer Y");
    expect(g).not.toMatch(/Where-Object/);
  });

  it("has the steps the status points to, from installing ComfyUI to the first model", () => {
    for (const g of guides.filter((g) => g.os !== "other")) {
      expect(g.text).toContain("## Step 0:");
      expect(g.text).toContain("https://www.comfy.org/download".repeat(g.os === "linux" ? 0 : 1));
      expect(g.text).toContain(`## Step ${MODEL_STEP[g.way]}: Get a first picture model`);
      expect(g.text).toContain("sd_xl_base_1.0.safetensors");
      expect(g.text).toContain("--create-dirs");
      expect(g.text).toContain("check_again_url");
      expect(g.text).not.toMatch(/\?n=2/);
    }
    const other = guides.find((x) => x.way === "direct" && x.os === "other")!.text;
    expect(other).toContain(`${SITE}/api/setup/guide/direct/windows`);
  });

  it("installs Fuobe Connect from its repository, with every command written out, then restarts ComfyUI", () => {
    const REPO = "https://github.com/workingprototype/ComfyUI-Fuobe-Connect";
    const step2 = (t: string) => t.slice(t.indexOf("## Step 2: Install Fuobe Connect"), t.indexOf("## Step 3: Connect"));
    const expected: Record<"windows" | "mac" | "linux", string[]> = {
      windows: [
        "   git --version",
        `   git clone ${REPO} "<custom_nodes>\\ComfyUI-Fuobe-Connect"`,
        `   curl.exe -fsSL -o "<custom_nodes>\\ComfyUI-Fuobe-Connect.zip" ${REPO}/archive/refs/heads/main.zip`,
        '   Expand-Archive "<custom_nodes>\\ComfyUI-Fuobe-Connect.zip" "<custom_nodes>"',
        '   Rename-Item "<custom_nodes>\\ComfyUI-Fuobe-Connect-main" ComfyUI-Fuobe-Connect',
        '   Remove-Item "<custom_nodes>\\ComfyUI-Fuobe-Connect.zip"',
        "   curl.exe -s http://127.0.0.1:8188/fuobe/connect",
      ],
      mac: [
        "   git --version",
        `   git clone ${REPO} "<custom_nodes>/ComfyUI-Fuobe-Connect"`,
        '   mkdir -p "<custom_nodes>/ComfyUI-Fuobe-Connect"',
        `   curl -fsSL ${REPO}/archive/refs/heads/main.tar.gz | tar -xz --strip-components=1 -C "<custom_nodes>/ComfyUI-Fuobe-Connect"`,
        "   curl -s http://127.0.0.1:8188/fuobe/connect",
      ],
      linux: [],
    };
    expected.linux = expected.mac;
    for (const g of guides.filter((g) => g.way === "connect" && g.os !== "other")) {
      const os = g.os as "windows" | "mac" | "linux";
      // Every command of the install, and nothing else: a command line starts with a program, never a dash or a sentence.
      expect(commands(step2(g.text)).filter((l) => !/^ {3}(- |[A-Z][a-z]+ )/.test(l)), os).toEqual(expected[os]);
      expect(g.text).toContain(`Fuobe Connect is a ComfyUI add-on (a custom node pack) from ${REPO} .`);
      expect(g.text).toContain("Install it with git or with the download below. ComfyUI-Manager's search can show Fuobe Connect too, but it may offer no version to install.");
      // ComfyUI-Manager installs it under the Registry's id.
      expect(g.text).toContain("a folder named ComfyUI-Fuobe-Connect, or fuobe-connect (ComfyUI-Manager's install).");
      expect(g.text).toContain("Install via Git URL");
      expect(g.text).toContain(`6. Install only Fuobe Connect, from ${REPO} . Do not install other custom nodes.`);
      expect(g.text).toContain("2. This way needs no new ComfyUI setting. Do not add --enable-cors-header. Never use --listen.");
      expect(g.text).toContain("Do not change or delete the person's own start files.");
      expect(g.text).toContain("Restarting ComfyUI stops what it is making now. Ask before it restarts.");
      // Nothing runs a downloaded script, and nothing installs Python packages.
      expect(g.text).not.toMatch(/\|\s*(sh|bash|iex|python)\b|Invoke-Expression|pip install/);
      // The restart for each install the person can have on this system.
      expect(g.text).toContain("4. Restart ComfyUI, so that it loads Fuobe Connect.");
      expect(g.text).toContain("   - Stability Matrix: stop ComfyUI and launch it again.");
      expect(g.text).toContain("stop ComfyUI with Ctrl+C in its window, then start it again with the same command.");
      expect(g.text.includes("   - ComfyUI Desktop: in ComfyUI, Manager, then Restart."), os).toBe(os !== "linux");
      expect(g.text.includes("   - Portable or Easy-Install: close ComfyUI's window"), os).toBe(os === "windows");
      expect(g.text.includes("   - A service or Docker: restart that service or container."), os).toBe(os === "linux");
      // Pairing: the code ComfyUI shows, approved in Fuobe; never a code from a link.
      expect(g.text).toContain("then Connect to Fuobe, and presses the Connect button");
      expect(g.text).toContain(`${SITE}/connect?pair=1`);
      expect(g.text).toContain("FUOBE_CONNECT_PAIR=1");
      // fuobe.com is trusted by Fuobe Connect itself: no studio to add.
      expect(g.text).not.toMatch(/FUOBE_CONNECT_ORIGINS|FUOBE_CONNECT_SITE|studios that may use this ComfyUI/);
      expect(g.text).toContain(`## Step ${MODEL_STEP.connect}: Get a first picture model`);
    }
  });

  it("adds a self-hosted studio to Fuobe Connect's list, which trusts only fuobe.com by itself", () => {
    const own = "https://studio.example.com";
    for (const os of ["windows", "mac", "linux"] as const) {
      const g = guideText({ way: "connect", os, site: own });
      expect(g).toContain(`enter ${own} in Fuobe studios that may use this ComfyUI. Or start ComfyUI with the environment variable FUOBE_CONNECT_ORIGINS=${own}.`);
      expect(g).toContain("except the picture model the status asks for and Fuobe Connect's own list of studios (Step 2).");
      expect(g).toContain(`FUOBE_CONNECT_SITE=${own}`);
      expect(g).toContain(`${own}/connect?pair=1`);
      expect(g).not.toContain("https://fuobe.com/");
    }
  });

  it("fills in the code and keeps only the person's browser for Copy instructions", () => {
    const g = guideText({ way: "direct", os: "windows", site: SITE });
    const filled = withCode(g, "ABCDEFGHJKMN", SITE, "firefox");
    expect(filled).toContain(`Status: ${SITE}/api/setup/ABCD-EFGH-JKMN`);
    expect(filled).not.toContain("<setup code>");
    expect(filled).toContain("Firefox: click the icon");
    expect(filled).not.toContain("Chrome or Edge: click");
    expect(filled).not.toContain("Brave: click");
  });
});

describe("the hand-offs", () => {
  const longest = `https://${"a".repeat(63)}.${"b".repeat(40)}.example:65535`;
  it("keep the message under 900 characters and the link under 2,000, for a long site address", () => {
    for (const site of [SITE, longest])
      for (const way of WAYS)
        for (const os of OSES as Os[])
          for (const phone of [false, true]) {
            const text = prefillText({ way, os, site, code: "ABCDEFGHJKMN", browser: "chrome", phone });
            expect(text.length, `${site} ${way} ${os}`).toBeLessThanOrEqual(PREFILL_MAX);
            for (const t of Object.keys(AI_TARGETS) as (keyof typeof AI_TARGETS)[]) expect(chatLink(t, text).length).toBeLessThanOrEqual(LINK_MAX);
          }
  });

  it("carry the guide and status addresses and the code, and nothing of the account", () => {
    const text = prefillText({ way: "direct", os: "windows", site: SITE, code: "abcd-efgh-jkmn", browser: "edge" });
    expect(text).toContain(`Steps: ${SITE}/api/setup/guide/direct/windows`);
    expect(text).toContain(`Fuobe's status for it: ${SITE}/api/setup/ABCD-EFGH-JKMN`);
    expect(text).toContain("I use Edge.");
    expect(text).toMatch(/^[\x0a\x20-\x7e]*$/);
    expect(chatLink("chatgpt", text)).toMatch(/^https:\/\/chatgpt\.com\/\?q=/);
    expect(chatLink("claude", text)).toMatch(/^https:\/\/claude\.ai\/new\?q=/);
    const phone = prefillText({ way: "address", os: "mac", site: SITE, code: "ABCDEFGHJKMN", browser: "safari", phone: true });
    expect(phone).toContain("I am on my phone now");
    expect(phone).toContain("not into this chat");
  });

  it("give coding agents one line that runs the same in bash, zsh, PowerShell and cmd", () => {
    for (const agent of ["claude", "codex", "gemini"] as const)
      for (const os of OSES as Os[])
        for (const way of WAYS) {
          const line = agentLine(agent, { way, os, site: SITE, code: "ABCDEFGHJKMN" });
          expect(line).toMatch(/^(claude|codex|gemini -i) "[A-Za-z0-9 .,:/-]+"$/);
          expect(line).toContain(os === "windows" ? "curl.exe" : "curl ");
        }
    expect(() => agentText({ way: "direct", os: "windows", site: "https://x.example/$(rm -rf)", code: "ABCDEFGHJKMN" })).toThrow();
  });

  it("Copy instructions holds the first line, the way to go, and the whole guide with the code", () => {
    const guide = guideText({ way: "address", os: "mac", site: SITE });
    const text = fullInstructions({ way: "address", os: "mac", site: SITE, code: "ABCDEFGHJKMN", browser: "safari" }, guide);
    expect(text.split("\n")[0]).toMatch(/^Please help me give the ComfyUI on my macOS computer a web address/);
    expect(text).toContain("Guide me one step at a time.");
    expect(text).toContain("Setup code: ABCD-EFGH-JKMN");
    expect(text).toContain("## Step 3: Start the web address");
  });
});
