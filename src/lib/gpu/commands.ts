import type { GpuInventory, IndexPack, RequirementIndex, StepKind } from "./types";

/**
 * Copy-paste commands for a fix plan (SPEC §8.3, review item 4): bash for Mac / Linux and PowerShell for
 * Windows. Every string comes from the index (repos, commits, file names, pinned URLs), except the folder
 * paths the viewer's ComfyUI reports, which must pass a strict allow-list and are single-quoted; anything
 * else falls back to $COMFY / $env:COMFY, with one line that says to set it. Tokens are never written in:
 * gated downloads read $HF_TOKEN, civitai ones $CIVITAI_KEY (review item 5).
 */

const SAFE_WIN = /^[A-Za-z]:\\[\w .\\-]*$/;
const SAFE_POSIX = /^\/[\w ./-]*$/;
const UNSAFE = /["'`$;|&\r\n<>()%!^]/;

/** A folder path from the viewer's ComfyUI, if it is plain enough to put in a command; null otherwise. */
export function safePath(p: string | undefined | null): { path: string; style: "win" | "posix" } | null {
  if (!p || p.length > 260 || UNSAFE.test(p)) return null;
  if (SAFE_WIN.test(p)) return { path: p.replace(/\\+$/, "") || p, style: "win" };
  if (SAFE_POSIX.test(p)) return { path: p.replace(/\/+$/, "") || "/", style: "posix" };
  return null;
}

/** Index strings (names, commits, URLs) still get checked: nothing that could break out of quotes. */
const plain = (s: string) => !/["'`$;|&\r\n]/.test(s);
const PLAIN_URL = /^https:\/\/[\w.-]+\/[\w./%~+:=@-]*(\?[\w.%~+=&-]*)?$/;

type Shell = "bash" | "ps";

export interface CommandContext {
  inv: GpuInventory | null;
  idx: RequirementIndex;
}

/** Where things go on the viewer's machine, per shell. */
class Layout {
  usesVar = { bash: false, ps: false };
  constructor(private readonly inv: GpuInventory | null) {}

  /** The ComfyUI folder, when the model roots name it: ".../ComfyUI/models/vae" → ".../ComfyUI". */
  private root(style: "win" | "posix"): string | null {
    for (const dirs of Object.values(this.inv?.comfy?.modelRoots ?? {})) {
      for (const d of dirs) {
        const s = safePath(d);
        if (!s || s.style !== style) continue;
        const m = /^(.*)[\\/]models[\\/][^\\/]+$/.exec(s.path);
        if (m && m[1]) return m[1];
      }
    }
    return null;
  }

  private known(shell: Shell, base: string | null, rest: string[]): string | null {
    if (!base) return null;
    const sep = shell === "ps" ? "\\" : "/";
    const p = [base, ...rest].join(sep);
    return shell === "ps" ? `'${p.replace(/'/g, "''")}'` : `'${p}'`;
  }

  private viaVar(shell: Shell, rest: string[]): string {
    this.usesVar[shell] = true;
    if (!rest.length) return shell === "ps" ? '"$env:COMFY"' : '"$COMFY"';
    return shell === "ps" ? `"$env:COMFY\\${rest.join("\\")}"` : `"$COMFY/${rest.join("/")}"`;
  }

  /** A path under the ComfyUI folder. */
  under(shell: Shell, ...rest: string[]): string {
    return this.known(shell, this.root(shell === "ps" ? "win" : "posix"), rest) ?? this.viaVar(shell, rest);
  }

  /** A model folder (its first configured path when it is known and plain). */
  modelDir(shell: Shell, folder: string, ...rest: string[]): string {
    const style = shell === "ps" ? "win" : "posix";
    const dir = (this.inv?.comfy?.modelRoots?.[folder] ?? []).map((d) => safePath(d)).find((s) => s?.style === style);
    return this.known(shell, dir?.path ?? null, rest) ?? this.under(shell, "models", folder, ...rest);
  }

  python(shell: Shell): string {
    if (shell === "ps" && this.inv?.comfy?.embeddedPython) return `& ${this.under("ps", "..", "python_embeded", "python.exe")}`;
    return "python";
  }

  header(shell: Shell): string {
    if (!this.usesVar[shell]) return "";
    return shell === "ps" ? '$env:COMFY = "C:\\ComfyUI"   # change this to your ComfyUI folder\n' : 'COMFY="$HOME/ComfyUI"   # change this to your ComfyUI folder\n';
  }
}

export interface CommandStep {
  kind: StepKind;
  pack?: string;
  /** folder/file */
  file?: string;
  lora?: { file: string; url?: string; download: "direct" | "civitai-token" | "hf-gated"; page?: string };
  /** For the licence steps: the page to open. */
  link?: string;
}

/** A download URL without any token a library entry might carry. */
function cleanUrl(url: string): string | null {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/token|key|auth/i.test(k)) u.searchParams.delete(k);
    const s = u.toString();
    return PLAIN_URL.test(s) && plain(s) ? s : null;
  } catch {
    return null;
  }
}

function restartLine(inv: GpuInventory | null): string {
  const env = (inv?.comfy?.deployEnv ?? "").toLowerCase();
  if (env.includes("desktop")) return "Restart ComfyUI Desktop from its tray menu";
  if (inv?.comfy?.embeddedPython) return "Close the ComfyUI window, then run run_nvidia_gpu.bat again";
  return "Press Ctrl+C in the ComfyUI window, then start it again with the same flags";
}

function packLines(shell: Shell, l: Layout, name: string, p: IndexPack, kind: StepKind): string[] {
  if (!plain(name) || !plain(p.repo) || !/^[0-9a-f]{7,40}$/.test(p.commit)) return [comment(shell, `Install ${name} by hand: ${p.repo}`)];
  const dest = l.under(shell, "custom_nodes", name);
  const py = l.python(shell);
  const req = l.under(shell, "custom_nodes", name, "requirements.txt");
  const pip = p.requirementsTxt ? [`${py} -m pip install -r ${req}`] : [];
  if (kind === "pack-repair") return [comment(shell, `${name} didn't start. Reinstall its Python packages, then restart ComfyUI`), ...pip];
  if (kind === "pack-update") return [`git -C ${dest} fetch origin`, `git -C ${dest} checkout ${p.commit}`, ...pip];
  if (p.subdir && plain(p.subdir)) {
    const src = l.under(shell, "custom_nodes", `.${name}-src`);
    const from = l.under(shell, "custom_nodes", `.${name}-src`, ...p.subdir.split("/"));
    return [
      `git clone --filter=blob:none --no-checkout ${p.repo} ${src}`,
      `git -C ${src} sparse-checkout set ${p.subdir}`,
      `git -C ${src} checkout ${p.commit}`,
      shell === "ps" ? `Copy-Item -Recurse -Force ${from} ${dest}` : `cp -r ${from} ${dest}`,
      ...pip,
    ];
  }
  return [`git clone ${p.repo} ${dest}`, `git -C ${dest} checkout ${p.commit}`, ...pip];
}

function download(shell: Shell, dir: string, target: string, url: string, auth: "" | "hf" | "civitai", replace: boolean): string[] {
  const header =
    auth === "hf" ? (shell === "ps" ? ' -H "Authorization: Bearer $env:HF_TOKEN"' : ' -H "Authorization: Bearer $HF_TOKEN"') : auth === "civitai" ? (shell === "ps" ? ' -H "Authorization: Bearer $env:CIVITAI_KEY"' : ' -H "Authorization: Bearer $CIVITAI_KEY"') : "";
  const lines = [shell === "ps" ? `New-Item -ItemType Directory -Force -Path ${dir} | Out-Null` : `mkdir -p ${dir}`];
  if (replace) lines.push(shell === "ps" ? `Remove-Item -Force ${target}` : `rm -f ${target}`);
  lines.push(`${shell === "ps" ? "curl.exe" : "curl"} -L -C - --fail${header} -o ${target} "${url}"`);
  return lines;
}

const comment = (_shell: Shell, text: string) => `# ${text.replace(/[\r\n]+/g, " ")}`;

function stepLines(shell: Shell, l: Layout, s: CommandStep, ctx: CommandContext): string[] {
  const { idx, inv } = ctx;
  switch (s.kind) {
    case "pack-install":
    case "pack-update":
    case "pack-repair": {
      const p = s.pack ? idx.packs[s.pack] : undefined;
      return p && s.pack ? packLines(shell, l, s.pack, p, s.kind) : [];
    }
    case "restart":
      return [comment(shell, restartLine(inv))];
    case "comfy-update": {
      if (inv?.comfy?.embeddedPython) return shell === "ps" ? [`& ${l.under("ps", "..", "update", "update_comfyui.bat")}`] : [comment(shell, "Run update\\update_comfyui.bat in your ComfyUI folder")];
      if ((inv?.comfy?.deployEnv ?? "").toLowerCase().includes("desktop")) return [comment(shell, "ComfyUI Desktop: Help → Check for updates")];
      return [`git -C ${l.under(shell)} pull`, `${l.python(shell)} -m pip install -r ${l.under(shell, "requirements.txt")}`];
    }
    case "core-missing":
      return [comment(shell, "Look for IMPORT FAILED in the ComfyUI window and install the Python package it names, then restart ComfyUI")];
    case "manager-enable":
      return [`${l.python(shell)} -m pip install -r ${l.under(shell, "manager_requirements.txt")}`, comment(shell, "Then start ComfyUI with --enable-manager")];
    case "hf-licence":
      return [
        comment(shell, `Accept the licence at ${s.link ?? "the model's Hugging Face page"}, then make a token at https://huggingface.co/settings/tokens`),
        shell === "ps" ? '$env:HF_TOKEN = "hf_your_token"' : 'export HF_TOKEN="hf_your_token"',
      ];
    case "civitai-key":
      return [comment(shell, "Make a civitai API key at https://civitai.com/user/account"), shell === "ps" ? '$env:CIVITAI_KEY = "your_key"' : 'export CIVITAI_KEY="your_key"'];
    case "isolated-worker":
      return [comment(shell, "Start a second ComfyUI for these add-ons: scripts/comfy/install-isolated-worker.sh in Fuobe's repository shows how")];
    case "model":
    case "model-replace": {
      const f = s.file ? idx.files[s.file as keyof RequirementIndex["files"]] : undefined;
      if (!f) return [];
      const url = cleanUrl(f.pinnedUrl) ?? cleanUrl(f.url);
      if (!url || !plain(f.file) || !plain(f.folder)) return [comment(shell, `Download ${f.file} into models/${f.folder}`)];
      return download(shell, l.modelDir(shell, f.folder), l.modelDir(shell, f.folder, f.file), url, f.gated ? "hf" : "", s.kind === "model-replace");
    }
    case "lora": {
      const lo = s.lora;
      if (!lo) return [];
      const url = lo.url ? cleanUrl(lo.url) : null;
      if (!url || !plain(lo.file) || /[\\/]/.test(lo.file)) return [comment(shell, `Download ${lo.file} into models/loras${lo.page ? ` from ${lo.page}` : ""}`)];
      return download(shell, l.modelDir(shell, "loras"), l.modelDir(shell, "loras", lo.file), url, lo.download === "civitai-token" ? "civitai" : lo.download === "hf-gated" ? "hf" : "", false);
    }
    default:
      return [];
  }
}

/** The commands for a list of steps, in order, for both shells. */
export function commandsFor(steps: CommandStep[], ctx: CommandContext): { bash: string; powershell: string; each: { bash: string; powershell: string }[] } {
  const l = new Layout(ctx.inv);
  const each = steps.map((s) => ({ bash: stepLines("bash", l, s, ctx).join("\n"), powershell: stepLines("ps", l, s, ctx).join("\n") }));
  const body = (k: "bash" | "powershell") => each.map((e) => e[k]).filter(Boolean).join("\n");
  return { bash: l.header("bash") + body("bash"), powershell: l.header("ps") + body("powershell"), each };
}
