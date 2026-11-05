/**
 * The steps an AI follows to connect a person's ComfyUI to Fuobe (GET /api/setup/guide/<way>/<computer>), as plain
 * text with "## Step N" headings (anchors #step-N). The same text, with the setup code filled in, is what "Copy
 * instructions" copies. ASCII only, and the only setting it ever names is --enable-cors-header <this site>
 * (tests/ai-setup-guide.test.ts checks every command and safety line). Pure.
 */
import { GUARD_SHA256 } from "@/lib/comfy-guard";
import { LIVE_NODES_SHA256 } from "@/lib/comfy-live-nodes";
import { FUOBE_CONNECT, trustedByDefault } from "@/lib/fuobe-connect";
import { showCode } from "./code";
import { MODEL_STEP, STOP_STEP } from "./next-step";
import { aiSetupHref, OS_NAME, type BrowserName, type Os, type Way } from "./ways";

/** A picture model's files, as the workflow manifest lists them (the guide route passes them in). */
export interface GuideModel {
  name: string;
  /** "for a GPU with 12 GB or more". */
  fits: string;
  files: { file: string; folder: string; url: string; sizeGb: number }[];
}

export interface GuideInput {
  way: Way;
  os: Os;
  /** The studio's own address (src/server/ai-setup.ts siteOf): never a visitor's word. */
  site: string;
  /** The first picture models to list under "Get a first picture model". */
  models?: GuideModel[];
}

const lines = (...parts: (string | false | null | undefined)[]) => parts.filter((p): p is string => typeof p === "string").join("\n");

/** The start file's name when the guide downloads it (it writes "Start ComfyUI for Fuobe.bat" next to ComfyUI itself). */
export const SETUP_BAT = "Fuobe ComfyUI setup.bat";

function header(i: GuideInput): string {
  const os = OS_NAME[i.os];
  const on = os ? `a ${os} computer` : "a computer";
  if (i.way === "address")
    return lines(
      `# Give ComfyUI a web address for Fuobe: ${os}`,
      "",
      `This page shows how to give the ComfyUI on ${on} a web address, so that Fuobe (${i.site}) can use it. Fuobe is a website that makes pictures, video and sound on the person's own GPU. Fuobe's server sends the person's runs to that address. cloudflared, a free app from Cloudflare, makes the address with no Cloudflare account. The address works while cloudflared runs, and it changes each time cloudflared starts. The person can read this on a phone, but every command runs on the computer that runs ComfyUI.`,
    );
  if (i.way === "connect")
    return lines(
      `# Connect ComfyUI to Fuobe with Fuobe Connect: ${os}`,
      "",
      `This page shows how to connect the ComfyUI on ${on} to Fuobe (${i.site}) with Fuobe Connect, a ComfyUI add-on (${FUOBE_CONNECT.gitUrl}). Fuobe is a website that makes pictures, video and sound on the person's own GPU. With Fuobe Connect, the Fuobe page in Chrome, Edge or Firefox on this computer uses ComfyUI with no new setting. In Safari, on a phone, or on a computer with no screen, the person pairs ComfyUI with their Fuobe account by a code instead, and runs go to it with no Fuobe tab open.`,
    );
  return lines(
    `# Connect ComfyUI to Fuobe: this browser, ${os}`,
    "",
    `This page shows how to connect the ComfyUI on ${on} to Fuobe (${i.site}). Fuobe is a website that makes pictures, video and sound on the person's own GPU. In this way, the Fuobe page in the person's browser talks to ComfyUI on this computer. For that, ComfyUI must let ${i.site} in. Fuobe's guard, a small file in ComfyUI's custom_nodes folder, keeps every other website out.`,
  );
}

const READ_WITH_CURL = (os: Os) =>
  `If you can run commands, read each address on this page with ${os === "windows" ? "curl.exe" : "curl"}, not with a web tool. A web tool can shorten or change what it reads, and it can show an old answer.`;

function statusBlock(site: string, code?: string): string {
  return code
    ? lines(
        "## Fuobe's status",
        "",
        `Setup code: ${showCode(code)}`,
        `Status: ${site}/api/setup/${showCode(code)}`,
        "The status shows what Fuobe sees now, and the next step. Read it after each step. Each answer ends with a new address to read the next time (check_again_url): use that one, so that no cache shows an old answer.",
      )
    : lines(
        "## Fuobe's status",
        "",
        `Status: ${site}/api/setup/<setup code>`,
        "Use the setup code from the person's message, like ABCD-EFGH-JKMN. The status shows what Fuobe sees now, and the next step. Read it after each step. Each answer ends with a new address to read the next time (check_again_url): use that one, so that no cache shows an old answer.",
      );
}

function rules(i: GuideInput): string {
  const shell =
    i.os === "windows"
      ? "Use PowerShell for the commands below. In Git Bash or WSL, run curl.exe, certutil and winget as they are, and run every other line through powershell.exe -NoProfile -Command '<the line>'. In WSL, use curl.exe (not curl) for 127.0.0.1 addresses."
      : i.os === "mac"
        ? "Use Terminal for the commands below."
        : i.os === "linux"
          ? "Use a terminal for the commands below."
          : null;
  if (i.way === "address")
    return lines(
      "## Rules",
      "",
      "1. Before each command, show it and say in one line what it does. Wait for the person to say yes.",
      "2. This way needs no new ComfyUI setting. Do not add --enable-cors-header. Never use --listen.",
      "3. Do not open ports in a firewall or a router. Do not turn off antivirus, the firewall, SmartScreen or Gatekeeper.",
      "4. Do not run cloudflared login, and do not make a named tunnel. The quick tunnel below needs no account.",
      "5. The web address works like a key. Anyone who has it can use all of this ComfyUI while the tunnel runs, including the installs of ComfyUI-Manager if it is there. Do not print it, keep it or post it anywhere. It goes only into Fuobe. Run the tunnel in a window the person can see, and only while they use Fuobe: they stop it when they are done (the last step).",
      "6. Do not install custom nodes. Do not change models or other settings, except the picture model the status asks for.",
      "7. Use the setup code only with the status address.",
      ...(shell ? ["", shell] : []),
    );
  if (i.way === "connect")
    return lines(
      "## Rules",
      "",
      "1. Before each command, show it and say in one line what it does. Wait for the person to say yes.",
      "2. This way needs no new ComfyUI setting. Do not add --enable-cors-header. Never use --listen.",
      "3. Do not open ports in a firewall or a router. Do not turn off antivirus, the firewall, SmartScreen or Gatekeeper.",
      "4. Do not change or delete the person's own start files.",
      "5. Restarting ComfyUI stops what it is making now. Ask before it restarts. Do not stop ComfyUI's python yourself: ask the person to close ComfyUI's window.",
      `6. Install only Fuobe Connect, from ${FUOBE_CONNECT.gitUrl} . Do not install other custom nodes. Do not change models or other settings, except the picture model the status asks for${trustedByDefault(i.site) ? "" : " and Fuobe Connect's own list of studios (Step 2)"}.`,
      "7. Use the setup code only with the status address.",
      ...(shell ? ["", shell] : []),
    );
  return lines(
    "## Rules",
    "",
    "1. Before each command, show it and say in one line what it does. Wait for the person to say yes.",
    `2. Use exactly this setting: --enable-cors-header ${i.site}`,
    "3. Never use --enable-cors-header * or --enable-cors-header with no address. Never use --listen.",
    "4. Do not open ports in a firewall or a router. Do not turn off antivirus, the firewall, SmartScreen or Gatekeeper.",
    "5. Do not change or delete the person's own start files. If a start file is needed, make a new one.",
    "6. Restarting ComfyUI stops what it is making now. Ask before it restarts. Do not stop ComfyUI's python yourself: ask the person to close ComfyUI's window.",
    "7. Install only Fuobe's two files (fuobe_guard.py and fuobe_live.py). Do not install other custom nodes. Do not change models or other settings, except the picture model the status asks for.",
    "8. Use the setup code only with the status address.",
    ...(shell ? ["", shell] : []),
  );
}

const curl = (os: Os) => (os === "windows" ? "curl.exe" : "curl");
/** The quick tunnel on a Mac or Linux, with its log in the folder only this user reads. */
const TUNNEL = "cloudflared tunnel --url http://127.0.0.1:8188 --logfile ~/.fuobe/tunnel.log";
const sep = (os: Os) => (os === "windows" ? "\\" : "/");

function stepZero(i: GuideInput): string {
  if (i.os === "mac")
    return lines(
      "## Step 0: Check the computer and ComfyUI",
      "",
      "1. Look at the chip:",
      "   sysctl -n machdep.cpu.brand_string",
      "   Fuobe's first pictures need Apple silicon (M1 or newer) with 16 GB of memory or more. On an Intel Mac, tell the person plainly that pictures are very slow there.",
      `2. With no usable GPU, Fuobe also runs with the person's own fal.ai or Replicate key (${i.site}/settings, then Your keys). Say so before a long install.`,
      "3. If ComfyUI is not installed, the easiest way is ComfyUI Desktop for Apple silicon: https://www.comfy.org/download . Ask the person first. They download it, open it and follow its steps. ComfyUI Desktop uses port 8000.",
    );
  if (i.os === "linux")
    return lines(
      "## Step 0: Check the GPU and ComfyUI",
      "",
      "1. Look at the graphics card:",
      "   nvidia-smi --query-gpu=name,memory.total --format=csv",
      "   Fuobe's first pictures need an NVIDIA card with 8 GB of memory or more. If nvidia-smi is missing, ask the person which graphics card the computer has.",
      `2. With no usable GPU, Fuobe also runs with the person's own fal.ai or Replicate key (${i.site}/settings, then Your keys). Say so before a long install.`,
      "3. If ComfyUI is not installed, install it as ComfyUI's own page shows (https://github.com/comfyanonymous/ComfyUI, the part named Manual Install). Ask the person first. Then start it with python main.py in its folder.",
    );
  return lines(
    "## Step 0: Check the GPU and ComfyUI",
    "",
    "1. Look at the graphics card:",
    "   nvidia-smi --query-gpu=name,memory.total --format=csv",
    "   Fuobe's first pictures need an NVIDIA card with 8 GB of memory or more. If nvidia-smi is missing, ask the person which graphics card the computer has.",
    `2. With no usable GPU, Fuobe also runs with the person's own fal.ai or Replicate key (${i.site}/settings, then Your keys). Say so before a long install.`,
    "3. If ComfyUI is not installed, the easiest way is ComfyUI Desktop: https://www.comfy.org/download . Ask the person first. They download the Windows installer, open it and follow its steps. ComfyUI Desktop uses port 8000.",
  );
}

function findComfy(i: GuideInput): string {
  const c = curl(i.os);
  const ask = lines(
    "1. Ask ComfyUI for its facts:",
    `   ${c} -s http://127.0.0.1:8188/system_stats`,
    ...(i.os === "linux"
      ? ["2. If nothing answers, ask the person to start ComfyUI and to read its port in its window."]
      : ["2. If nothing answers, try the port of ComfyUI Desktop:", `   ${c} -s http://127.0.0.1:8000/system_stats`, '3. If neither answers, ask the person to start ComfyUI and to read the port in its window ("To see the GUI go to: http://127.0.0.1:PORT").']),
  );
  const where =
    i.os === "windows"
      ? lines(
          '4. In the answer, "embedded_python": true means the portable build or Easy-Install. Port 8000 means ComfyUI Desktop.',
          "5. Find the program on that port. Put the port in place of 8188:",
          "   Get-NetTCPConnection -LocalPort 8188 -State Listen | Select-Object -ExpandProperty OwningProcess",
          "6. Read its command line and its program. Put the number from item 5 in place of 1234:",
          '   Get-CimInstance Win32_Process -Filter "ProcessId=1234" | Select-Object -ExpandProperty CommandLine',
          '   Get-CimInstance Win32_Process -Filter "ProcessId=1234" | Select-Object -ExpandProperty ExecutablePath',
          "   If the command line has --base-directory <folder>, that folder holds custom_nodes and models. If not, custom_nodes and models are next to main.py.",
          "",
          "Common places for custom_nodes:",
          "- Portable: ComfyUI_windows_portable\\ComfyUI\\custom_nodes",
          "- Easy-Install: ComfyUI-Easy-Install\\ComfyUI\\custom_nodes",
          "- ComfyUI Desktop: Documents\\ComfyUI\\custom_nodes, unless the person chose another folder",
          "- Stability Matrix: ComfyUI's three-dot menu, then Open in Explorer, then custom_nodes",
          "- A git install: ComfyUI\\custom_nodes",
        )
      : i.os === "mac"
        ? lines(
            "4. Find the program on that port and the folder it runs in. Put the port in place of 8188, and the number that the first command shows in place of PID:",
            "   lsof -nP -iTCP:8188 -sTCP:LISTEN",
            "   ps -o command= -p PID",
            "   lsof -a -p PID -d cwd -Fn | tail -1",
            "   If the command has --base-directory <folder>, that folder holds custom_nodes and models. If not, custom_nodes and models are next to main.py.",
            "",
            "Common places for custom_nodes:",
            "- ComfyUI Desktop: ~/Documents/ComfyUI/custom_nodes, unless the person chose another folder",
            "- A git install: ~/ComfyUI/custom_nodes",
            "- Stability Matrix: ComfyUI's three-dot menu, then Open in Finder, then custom_nodes",
          )
        : lines(
            "3. Find the program on that port and the folder it runs in. Put the number that the first command shows in place of PID:",
            "   ss -ltnp 'sport = :8188'",
            "   tr '\\0' ' ' < /proc/PID/cmdline; echo",
            "   readlink /proc/PID/cwd",
            "   If the command has --base-directory <folder>, that folder holds custom_nodes and models. If not, custom_nodes and models are next to main.py.",
            i.way === "direct" &&
              "4. If ComfyUI runs as a service or in Docker, the setting goes into the start command of that service or container. Ask the person before you change a service or a container.",
            i.way === "connect" &&
              "4. If ComfyUI runs in Docker, custom_nodes is the folder that the container maps to its custom_nodes. Ask the person which folder that is.",
            "",
            "Common places for custom_nodes:",
            "- A git install: ~/ComfyUI/custom_nodes",
            "- Stability Matrix: ComfyUI's three-dot menu, then Open folder, then custom_nodes",
          );
  const manager =
    i.way === "address" &&
    lines(
      "",
      "Below, put that port in place of 8188. The models folder is next to custom_nodes (Step 5 needs it).",
      "If custom_nodes holds a folder named ComfyUI-Manager (or comfyui-manager), tell the person before Step 3: anyone who has the web address can install add-ons with ComfyUI-Manager while the tunnel runs. In Chrome, Edge or Firefox on this computer, Fuobe needs no web address (the way This browser in Fuobe).",
    );
  return lines("## Step 1: Find ComfyUI", "", ask, where, manager);
}

function guardStep(i: GuideInput): string {
  const c = curl(i.os);
  const s = sep(i.os);
  const hash = (file: string) => (i.os === "windows" ? `   certutil -hashfile "<custom_nodes>${s}${file}" SHA256` : i.os === "mac" ? `   shasum -a 256 "<custom_nodes>${s}${file}"` : `   sha256sum "<custom_nodes>${s}${file}"`);
  return lines(
    "## Step 2: Add Fuobe's guard",
    "",
    i.os === "windows" && "Portable build or Easy-Install: skip this step. Fuobe's start file in Step 3 adds both files.",
    i.os === "windows" && "",
    "1. Download the guard into custom_nodes. Put the real folder in place of <custom_nodes>:",
    `   ${c} -fsSL ${i.site}/api/setup/files/fuobe_guard.py -o "<custom_nodes>${s}fuobe_guard.py"`,
    "2. Make sure that the file is the right one:",
    hash("fuobe_guard.py"),
    `   The hash must be ${GUARD_SHA256}. Capital and small letters both match. If the hash is different, delete the file and stop.`,
    "3. Fuobe's live edit nodes go in the same folder (Fuobe's Live edit needs them):",
    `   ${c} -fsSL ${i.site}/api/live/nodes -o "<custom_nodes>${s}fuobe_live.py"`,
    hash("fuobe_live.py"),
    `   The hash must be ${LIVE_NODES_SHA256}. If the hash is different, delete the file and stop.`,
  );
}

function settingStep(i: GuideInput): string {
  const flag = `--enable-cors-header ${i.site}`;
  const intro = lines(
    "## Step 3: Start ComfyUI with Fuobe's setting",
    "",
    "Do the part for the person's install. Each part restarts ComfyUI once. An auto-restart window or a watchdog can start ComfyUI again the old way: ask the person to close it first.",
  );
  const desktop = lines(
    "ComfyUI Desktop:",
    "1. Ask the person to open Settings (the gear, bottom left), then Server-Config.",
    `2. In Enable CORS header, paste ${i.site} and nothing else.`,
    "3. Press Restart when ComfyUI asks.",
  );
  const matrix = lines(
    "Stability Matrix:",
    "1. Ask the person to open Packages, then ComfyUI's three-dot menu, then Launch Options.",
    `2. Add ${flag} to Extra Launch Arguments.`,
    "3. Stop ComfyUI and launch it again.",
  );
  const terminal = (py: string) =>
    lines(
      i.os === "mac" ? "Started from Terminal:" : "Started from a terminal:",
      "1. Ask the person to stop ComfyUI with Ctrl+C in its window.",
      "2. In ComfyUI's folder, start it in that window with the same command as before, plus the setting. If the person uses a virtual environment, activate it first. For example:",
      `   ${py} main.py ${flag}`,
    );
  if (i.os === "windows")
    return lines(
      intro,
      "",
      desktop,
      "",
      "Portable or Easy-Install: use Fuobe's start file. It finds the ComfyUI on the port, asks Y or N before it restarts it, keeps its other settings, adds Fuobe's guard and live nodes, and starts it again with the setting. It leaves the person's own start files as they are.",
      "1. Download it. Put the port in place of 8188, and the folder that holds the person's usual start file (run_nvidia_gpu.bat or Start ComfyUI.bat) in place of <folder>:",
      `   curl.exe -fsSL ${i.site}/api/setup/files/start/8188 -o "<folder>\\${SETUP_BAT}"`,
      "2. Read the file before you open it. It is plain text.",
      "3. Open it in a window of its own, and ask the person to answer Y in that window:",
      `   Start-Process "<folder>\\${SETUP_BAT}"`,
      "4. Next time, the person starts ComfyUI with Start ComfyUI for Fuobe.bat, which it leaves next to ComfyUI.",
      "",
      matrix,
      "",
      terminal("python"),
    );
  if (i.os === "mac") return lines(intro, "", desktop, "", matrix, "", terminal("python3"));
  return lines(intro, "", matrix, "", terminal("python3"));
}

function checkStep(i: GuideInput): string {
  const c = curl(i.os);
  const nul = i.os === "windows" ? "NUL" : "/dev/null";
  const nl = i.os === "windows" ? "" : "\\n";
  return lines(
    "## Step 4: Make sure that it works",
    "",
    "Put the port from Step 1 in place of 8188.",
    `1. The guard answers {"guard": 1}:`,
    `   ${c} -s http://127.0.0.1:8188/fuobe/guard`,
    `2. ComfyUI lets Fuobe in. The answer has the line Access-Control-Allow-Origin: ${i.site}`,
    `   ${c} -s -o ${nul} -D - -H "Origin: ${i.site}" http://127.0.0.1:8188/system_stats`,
    "3. ComfyUI turns other websites away. The answer is 403:",
    `   ${c} -s -o ${nul} -w "%{http_code}${nl}" -H "Origin: https://example.com" http://127.0.0.1:8188/system_stats`,
    "4. Read the status. Fuobe connects by itself when it sees ComfyUI.",
  );
}

/** The browser lines of "Finish in Fuobe" (Copy instructions keeps only the person's browser). */
const BROWSER_LINES: { names: BrowserName[]; line: string }[] = [
  { names: ["chrome", "edge", "opera", "other"], line: "   - Chrome or Edge: click the icon to the left of the address, turn on Apps on device, then reload the Fuobe tab." },
  { names: ["firefox"], line: "   - Firefox: click the icon to the left of the address, allow apps and services on this device, then reload." },
  { names: ["brave"], line: "   - Brave: click the Brave icon, allow localhost access, then reload." },
];

function finishDirect(i: GuideInput): string {
  const host = new URL(i.site).host;
  return lines(
    "## Step 5: Finish in Fuobe",
    "",
    `1. The browser can ask the person to let ${host} access other apps and services on this device. The person presses Allow.`,
    "2. If the browser blocked it before:",
    ...BROWSER_LINES.map((b) => b.line),
    "3. Read the status. When ComfyUI is running, Fuobe is allowed in and the guard is in place, Fuobe connects by itself.",
  );
}

function modelStep(i: GuideInput): string {
  const n = MODEL_STEP[i.way];
  const c = curl(i.os);
  const s = sep(i.os);
  const blocks = (i.models ?? []).map((m) => {
    const total = m.files.reduce((a, f) => a + f.sizeGb, 0);
    return lines(
      `${m.name} (${total.toFixed(1)} GB in all, ${m.fits}):`,
      ...m.files.map((f) => `   ${c} -fL --create-dirs -o "<models>${s}${f.folder.replaceAll("/", s)}${s}${f.file}" "${f.url}"`),
    );
  });
  return lines(
    `## Step ${n}: Get a first picture model`,
    "",
    "Do this step only when the status asks for it. The status names the model that fits this GPU. Ask the person first: the files are big, and the download can take a long time.",
    "Put the files in the models folder that is next to custom_nodes (Step 1). Put the real folder in place of <models>.",
    "",
    ...blocks.flatMap((b) => [b, ""]),
    "After the download, Fuobe sees the model by itself within a minute. Read the status again. When it asks, the person presses Make your first picture in Fuobe.",
    "When the status says done, the setup is finished.",
  );
}

function addressSteps(i: GuideInput): string {
  const os = i.os;
  const install =
    os === "windows"
      ? lines(
          "## Step 2: Install cloudflared",
          "",
          "1. Look for it:",
          "   cloudflared --version",
          "2. If it is missing, install it:",
          "   winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements",
          "   Windows can ask the person for permission. After the install, a new terminal finds cloudflared. In the same terminal, use its full path, C:\\Program Files (x86)\\cloudflared\\cloudflared.exe, in place of cloudflared.",
          "3. If winget is missing, the person downloads and opens:",
          "   https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.msi",
        )
      : os === "mac"
        ? lines(
            "## Step 2: Install cloudflared",
            "",
            "1. Look for it:",
            "   cloudflared --version",
            "2. If it is missing and Homebrew is there (brew --version answers), install it:",
            "   brew install cloudflared",
            "3. If Homebrew is missing, the person downloads and opens the installer for their Mac. uname -m says arm64 on Apple silicon and x86_64 on Intel:",
            "   https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-arm64.pkg",
            "   https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-amd64.pkg",
          )
        : lines(
            "## Step 2: Install cloudflared",
            "",
            "1. Look for it:",
            "   cloudflared --version",
            "2. If it is missing, read the machine type. uname -m says x86_64 (use amd64) or aarch64 (use arm64).",
            "3. On Debian or Ubuntu, install the package. sudo asks for the person's password:",
            "   curl -fsSLO https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb",
            "   sudo dpkg -i cloudflared-linux-amd64.deb",
            "4. On other systems, use the program file itself:",
            "   curl -fsSL -o cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64",
            "   chmod +x cloudflared",
            "   Then use ./cloudflared in place of cloudflared below.",
            "For arm64, use the same names with arm64 in place of amd64.",
          );
  const start =
    os === "windows"
      ? lines(
          "## Step 3: Start the web address",
          "",
          "1. Make a folder in the person's own user folder for the tunnel's log (other users of the computer can't read it), and remove an old log, so that the address you read is the new one:",
          "   New-Item -ItemType Directory -Force ~\\.fuobe | Out-Null; Get-ChildItem ~\\.fuobe -Filter tunnel.log | Remove-Item",
          "2. Start the tunnel in a window of its own, with its log in that folder. It keeps the tunnel's process number, to stop only this tunnel later:",
          '   Start-Process cloudflared -WorkingDirectory ~\\.fuobe -ArgumentList "tunnel","--url","http://127.0.0.1:8188","--logfile","tunnel.log" -PassThru | Select-Object -ExpandProperty Id | Set-Content ~\\.fuobe\\tunnel.pid',
          "3. Wait about 10 seconds. Then put the address on the clipboard without showing it:",
          '   Select-String -Path ~\\.fuobe\\tunnel.log -Pattern "https://[-a-z0-9]+[.]trycloudflare[.]com" | Select-Object -Last 1 | ForEach-Object Matches | ForEach-Object Value | Set-Clipboard',
          "   If the clipboard stays empty, wait 10 seconds more and run it again.",
          "4. Do not print, read out or keep the address. Tell the person to keep the cloudflared window open. Closing it stops the address.",
        )
      : lines(
          "## Step 3: Start the web address",
          "",
          "1. Make a folder that only this user can read, for the tunnel's log, and remove an old log, so that the address you read is the new one:",
          "   mkdir -p -m 700 ~/.fuobe && rm -f ~/.fuobe/tunnel.log",
          ...(os === "mac"
            ? [
                "2. Start the tunnel in a Terminal window of its own, so the person sees it run. macOS can ask the person to let your app control Terminal: they press OK.",
                `   osascript -e 'tell application "Terminal" to do script "${TUNNEL}"'`,
                `   If that doesn't work, ask the person to open a new Terminal window and to run this in it: ${TUNNEL}`,
              ]
            : [
                "2. Ask the person to open a new terminal window and to run this in it, so they see the tunnel run. On GNOME, gnome-terminal -- <the command> opens that window for them:",
                `   ${TUNNEL}`,
              ]),
          "3. Wait about 10 seconds. Then put the address on the clipboard without showing it:",
          os === "mac"
            ? "   grep -o 'https://[-a-z0-9]*\\.trycloudflare\\.com' ~/.fuobe/tunnel.log | tail -1 | pbcopy"
            : "   grep -o 'https://[-a-z0-9]*\\.trycloudflare\\.com' ~/.fuobe/tunnel.log | tail -1 | xclip -selection clipboard",
          os === "linux" ? "   On Wayland, use wl-copy in place of xclip -selection clipboard. If neither is there, ask the person to copy the address that ends in trycloudflare.com from the tunnel's window." : false,
          "   If the clipboard stays empty, wait 10 seconds more and run it again.",
          "4. Do not print, read out or keep the address. Tell the person to keep the tunnel's window open while Fuobe runs. Closing it stops the address.",
        );
  const give = lines(
    "## Step 4: Give the address to Fuobe",
    "",
    `1. Ask the person to paste the address (it is on this computer's clipboard) into Your ComfyUI's web address in Fuobe, then press Connect. Fuobe tests it. In a chat, do not ask the person to paste it into the chat.`,
    `2. If Fuobe is open only on a phone, or not open at all: the person opens ${i.site}${aiSetupHref("address")} in a browser on this computer, and signs in with the same account. Fuobe shows the box Your ComfyUI's web address there, with the same setup code. If the code is different, they signed in with another account. They paste the address there and press Connect.`,
    "3. Read the status. When the web address works and Fuobe is connected, go on.",
  );
  const stop = lines(
    `## Step ${STOP_STEP}: When the person is done`,
    "",
    "Runs reach ComfyUI only while cloudflared runs, and so does anyone else who has the address. When the person is done, they close the tunnel's window. Or stop this tunnel (and no other cloudflared the person runs):",
    os === "windows" ? "   Stop-Process -Id (Get-Content ~\\.fuobe\\tunnel.pid)" : "   pkill -f .fuobe/tunnel.log",
    "The next time cloudflared starts, it makes a new address. The person pastes the new one in Fuobe.",
  );
  return lines(stepZero(i), "", findComfy(i), "", install, "", start, "", give, "", modelStep(i), "", stop);
}

function connectSteps(i: GuideInput): string {
  const c = curl(i.os);
  const s = sep(i.os);
  const { gitUrl, folder, archive } = FUOBE_CONNECT;
  const dir = `<custom_nodes>${s}${folder}`;
  const own = !trustedByDefault(i.site);
  const download =
    i.os === "windows"
      ? [
          `   curl.exe -fsSL -o "${dir}.zip" ${archive}.zip`,
          `   Expand-Archive "${dir}.zip" "<custom_nodes>"`,
          `   Rename-Item "${dir}-main" ${folder}`,
          `   Remove-Item "${dir}.zip"`,
        ]
      : [`   mkdir -p "${dir}"`, `   curl -fsSL ${archive}.tar.gz | tar -xz --strip-components=1 -C "${dir}"`];
  const install = lines(
    "## Step 2: Install Fuobe Connect",
    "",
    `Fuobe Connect is a ComfyUI add-on (a custom node pack) from ${gitUrl} . It installs no Python packages.`,
    "ComfyUI-Manager's search may not list Fuobe Connect yet. Install it with git or with the download below. The person can also use Install via Git URL in ComfyUI-Manager with the same address, if their Manager allows it.",
    `1. Look in custom_nodes (Step 1) for a folder named ${folder}. If it is there, Fuobe Connect is installed: go to item 5.`,
    "2. Look for git:",
    "   git --version",
    "   If it answers, clone Fuobe Connect into custom_nodes. Put the real folder in place of <custom_nodes>:",
    `   git clone ${gitUrl} "${dir}"`,
    "3. If git is missing, download Fuobe Connect and unpack it into custom_nodes instead. Put the real folder in place of <custom_nodes>:",
    ...download,
    "4. Restart ComfyUI, so that it loads Fuobe Connect. Ask the person first. Do the part for their install:",
    i.os !== "linux" && "   - ComfyUI Desktop: in ComfyUI, Manager, then Restart. Or quit ComfyUI Desktop and open it again.",
    i.os === "windows" && "   - Portable or Easy-Install: close ComfyUI's window, then start ComfyUI again the usual way (for example run_nvidia_gpu.bat).",
    "   - Stability Matrix: stop ComfyUI and launch it again.",
    `   - Started from ${i.os === "mac" ? "Terminal" : "a terminal"}: stop ComfyUI with Ctrl+C in its window, then start it again with the same command.`,
    i.os === "linux" && "   - A service or Docker: restart that service or container.",
    `5. Make sure that ComfyUI loaded it. Put ComfyUI's port in place of 8188. The answer has "connect": 1:`,
    `   ${c} -s http://127.0.0.1:8188/fuobe/connect`,
    `   If nothing answers, ComfyUI is still starting: wait 30 seconds, then try again. If the answer is 404, ComfyUI didn't load Fuobe Connect: make sure that __init__.py is right inside ${dir} (not in a second folder inside it), and read the last lines of ComfyUI's window with the person.`,
    own &&
      `6. Fuobe Connect trusts https://fuobe.com by itself, not this studio. Ask the person to open ComfyUI's Settings, then Fuobe Connect, and to enter ${i.site} in Fuobe studios that may use this ComfyUI. Or start ComfyUI with the environment variable FUOBE_CONNECT_ORIGINS=${i.site}.`,
  );
  const host = new URL(i.site).host;
  const headless =
    i.os === "windows"
      ? `3. On a computer with no screen, start ComfyUI with the environment variable FUOBE_CONNECT_PAIR=1${own ? ` and FUOBE_CONNECT_SITE=${i.site}` : ""}: in Command Prompt, run set FUOBE_CONNECT_PAIR=1${own ? ` and set FUOBE_CONNECT_SITE=${i.site}` : ""}, then start ComfyUI in the same window. The code and the link to approve it are then in ComfyUI's window.`
      : `3. On a computer with no screen, start ComfyUI with the environment variable FUOBE_CONNECT_PAIR=1${own ? ` and FUOBE_CONNECT_SITE=${i.site}` : ""}, for example in ComfyUI's folder:`;
  const connect = lines(
    "## Step 3: Connect",
    "",
    "In Chrome, Edge or Firefox on the computer that runs ComfyUI:",
    `1. The browser can ask the person to let ${host} access other apps and services on this device. The person presses Allow.`,
    "2. If the browser blocked it before:",
    ...BROWSER_LINES.map((b) => b.line),
    "3. Read the status. Fuobe connects by itself when it sees Fuobe Connect.",
    "",
    "In Safari, on a phone, or for a computer with no screen, pair ComfyUI with the person's Fuobe account. The commands still run on the computer that runs ComfyUI:",
    "1. In ComfyUI, the person opens Extensions (in ComfyUI's top menu), then Connect to Fuobe, and presses the Connect button. ComfyUI shows a code like ABCD-EFGH.",
    `2. The person types that code into Fuobe, in the box The code ComfyUI shows, and presses Approve. The box is on Fuobe's setup page, and at ${i.site}/connect?pair=1, signed in to the same account.`,
    headless,
    i.os !== "windows" && `   ${own ? `FUOBE_CONNECT_SITE=${i.site} ` : ""}FUOBE_CONNECT_PAIR=1 python3 main.py`,
    i.os !== "windows" && "   The code and the link to approve it are then in ComfyUI's window or its log.",
    "4. Read the status. Once the person approves the code, runs go to this ComfyUI with no Fuobe tab open, while ComfyUI runs.",
  );
  return lines(stepZero(i), "", findComfy(i), "", install, "", connect, "", modelStep(i));
}

/** The guide for a computer whose system isn't known: which one, then that guide. */
function otherGuide(i: GuideInput, code?: string): string {
  return lines(
    "# Connect ComfyUI to Fuobe",
    "",
    "First ask the person which system runs ComfyUI: Windows, macOS or Linux. Then read the steps for that system:",
    `- Windows: ${i.site}/api/setup/guide/${i.way}/windows`,
    `- macOS: ${i.site}/api/setup/guide/${i.way}/mac`,
    `- Linux: ${i.site}/api/setup/guide/${i.way}/linux`,
    "",
    statusBlock(i.site, code),
  );
}

/** The whole guide. `code`: filled in (Copy instructions); without it the status line asks for the code from the message. */
export function guideText(i: GuideInput, code?: string): string {
  if (i.os === "other") return otherGuide(i, code) + "\n";
  const top = lines(header(i), "", READ_WITH_CURL(i.os), "", statusBlock(i.site, code), "", rules(i));
  const body =
    i.way === "address"
      ? addressSteps(i)
      : i.way === "connect"
        ? connectSteps(i)
        : lines(stepZero(i), "", findComfy(i), "", guardStep(i), "", settingStep(i), "", checkStep(i), "", finishDirect(i), "", modelStep(i));
  return lines(top, "", body, "", "If you are stuck, read the next step in the status and do it.") + "\n";
}

/** The served guide with the code filled in, and only the person's browser in "Finish in Fuobe" (Copy instructions). */
export function withCode(guide: string, code: string, site: string, browser?: BrowserName): string {
  let text = guide
    .replace(`Status: ${site}/api/setup/<setup code>`, `Setup code: ${showCode(code)}\nStatus: ${site}/api/setup/${showCode(code)}`)
    .replace("Use the setup code from the person's message, like ABCD-EFGH-JKMN. ", "");
  if (browser) {
    const keep = BROWSER_LINES.find((b) => b.names.includes(browser))?.line;
    for (const b of BROWSER_LINES) if (b.line !== keep) text = text.replace(`${b.line}\n`, "");
  }
  return text;
}
