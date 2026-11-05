# Fuobe Connect

A ComfyUI custom node pack. It lets [Fuobe](https://github.com/workingprototype/Fuobe) use your ComfyUI with one
install, the way ComfyUI's own page uses it at `http://127.0.0.1:8188`. You do not need a start flag, a second file or
a changed start file. It adds no nodes.

## Install

**ComfyUI-Manager:** open the Manager, choose **Custom Nodes Manager**, search for `Fuobe Connect`, press **Install**,
then press **Restart**.

**Git:** in a terminal, in ComfyUI's `custom_nodes` folder:

```
git clone https://github.com/workingprototype/ComfyUI-Fuobe-Connect
```

Then restart ComfyUI.

Then open Fuobe and choose **Connect your GPU**. Chrome and Edge ask once to let the page reach apps on this computer.
Press **Allow**. Fuobe finds ComfyUI and connects. If your browser can't reach this computer from a website (Safari,
phones, some other browsers), use pairing (below).

## What a trusted studio can do

**Direct mode (the default).** ComfyUI turns away requests from every other website. Fuobe Connect adds one exception:
the Fuobe studios you trust. By default these are `https://fuobe.com` and `https://www.fuobe.com`. A studio's address
must start with `https://` (`http://` only for a studio on this computer, such as `http://localhost:3000`).

A trusted studio reaches this ComfyUI only at `127.0.0.1`, `::1` or `localhost`, never at a network address. Its page
can:

- read ComfyUI's facts (`/system_stats`: version, GPU, memory, start options), its node list and the file lists of its
  model folders, with each folder's place on disk (every folder ComfyUI lists, except `custom_nodes` and `configs`). In
  the node list, the loaders show only Fuobe's own input files, not your file names;
- upload a run's input into the input folder, only under a name Fuobe gives (`fuobe_<id>.png` and similar), only as a
  picture, clip, sound, 3D scene or data file. It can replace an earlier Fuobe input, never a file of yours;
- queue a workflow. Fuobe Connect checks every workflow here, in Python, before ComfyUI sees it:
  - every node type must be on the list this pack ships (`fuobe_connect/allowed_nodes.json`: the nodes Fuobe's own
    workflows use), or on your own list (below). A studio can't add to either list;
  - no text may name a place: an absolute path in any form (`/x`, `\x`, `//host/share`, `\\?\C:\x`, `C:\x`, or a
    drive with no slash such as `D:x`), a `..` step, a home folder (`~`, `~user`), an environment variable at the start
    (`$HOME/`, `%USERPROFILE%\`), a URL, a ComfyUI folder tag such as `name [output]`, or a key in JSON that names a
    file, a folder or an address (`"video_path": …`). Spaces and quotes in front don't hide one;
  - an input that a listed node reads as a file or a folder takes only the one value or form that Fuobe's own
    workflows use, written in the workflow itself and never worked out by another node. For example, the source
    paths of `MiniMaxH3SourceTimeline` must be empty, and the subtitle file of `AILab_Qwen3ASRSubtitle` must be empty
    or under `fuobe/` in your output folder. `PATH_INPUTS` in `fuobe_connect/graph.py` lists every one;
  - every file loader must read a Fuobe input (`fuobe_<id>.<ext>`), never a file of yours;
  - the workflow may not give a node a JSON object (ComfyUI passes one on unchecked), except a 3D view's entries.

  A workflow that uses an installed node from the list can still do what that node does in ComfyUI's own folders: for
  example, save into your output folder, or keep a node pack's own cache;
- see, follow, cancel, stop and remove only the prompts it queued (and a batch's later passes, which save under
  `fuobe/<id>`). In the queue, your own prompts show only as places in the line. It can't clear the queue or stop
  your own work;
- download only the results that its own prompts' history lists;
- open ComfyUI's live socket only under a Fuobe client id (`fuobe-…`), never your own ComfyUI tab's.

A trusted studio can't reach the Manager's install calls, your user files or your settings. It can't read a file of
yours in the input folder or download a result of yours, and its workflows can't open a file of yours by its path. Of
ComfyUI's folder lists it can't read `custom_nodes` (every file of your node packs) or `configs`. Every other website
still meets ComfyUI's own check, unchanged. Nothing in ComfyUI's own files changes.

If ComfyUI runs with `--enable-cors-header` (an older Fuobe setup), ComfyUI's own check is off. Fuobe Connect then also
turns away every website except ComfyUI's own page, the site that the setting names and the trusted studios. This is
what Fuobe's guard file did, so you can delete `fuobe_guard.py` and the setting.

## Choose your studios, or none

Open ComfyUI's **Settings → Fuobe Connect** and enter the studios that may use this ComfyUI, separated by commas, for
example `https://studio.example.com`. Type `none` to let no website use this ComfyUI from the browser. Pairing still
works.

You can also set the environment variable `FUOBE_CONNECT_ORIGINS` before you start ComfyUI (`none` works there too).
When it is set, it wins over the setting, and ComfyUI shows a note about it.

**Your own node list.** If your studio uses a node type that isn't on the shipped list, add it to
`fuobe-connect-nodes.json` in ComfyUI's `user` folder: `{"nodes": ["MyNode"]}`. Only you can change this file. A
studio can't.

**A network address.** A trusted studio reaches this ComfyUI only on this computer. To let it reach a ComfyUI that
runs with `--listen` at a network address, start ComfyUI with `FUOBE_CONNECT_LAN=1`.

**A name for ComfyUI's page.** Fuobe Connect's own window works when you open ComfyUI at `127.0.0.1`, `localhost` or
an IP address. If you open it by a name (for example `comfy.local`, or a domain in front of it), set
`FUOBE_CONNECT_HOSTS=comfy.local` before you start ComfyUI. This keeps a website that points its own name at your
computer out of the window's settings.

## Pairing (for Safari, phones and PCs with no screen)

In ComfyUI, open **Extensions → Connect to Fuobe**. You can give this computer a name. Press **Connect**. ComfyUI
shows a short code. Open the link on any device, sign in to Fuobe and approve the code. Approve only a code that you
see in your own ComfyUI. From then on, ComfyUI gets that one person's jobs from the studio over HTTPS, and it runs them
with no Fuobe tab open. It opens no port. The token belongs to you alone, so another person's jobs never reach your PC.

Pairing works only with a studio you trust, or with `https://fuobe.com`. Every job gets the same checks as in direct
mode, before it reaches ComfyUI. The job's inputs leave the input folder when the job is done.

The **Connect to Fuobe** window shows the studio, the account that approved the code (when the studio says), and the
last jobs with their node types and times. **Pause jobs** stops this computer from taking new jobs. **Disconnect** tells
the studio to forget this computer first. If the studio can't be reached, Fuobe Connect keeps trying every minute, and
you can also remove the computer in Fuobe's settings.

On a PC with no screen, start ComfyUI with `FUOBE_CONNECT_PAIR=1`. The code and the link then appear in ComfyUI's
console. `FUOBE_CONNECT_SITE=https://studio.example.com` chooses the studio for that.

**What pairing sends to the studio.** When you press Connect: this computer's name (the one you typed, else its
network name), the GPU's name, its memory and ComfyUI's version. While paired, about every minute: the GPU's name and
memory, the computer's memory, the operating system, ComfyUI's version, whether ComfyUI is the portable build, and the
progress of a running job. Every five minutes: the file names in your `loras` folder (up to 20,000), so Fuobe can use
your LoRAs. To stop sending the LoRA names, start ComfyUI with `FUOBE_CONNECT_LORAS=0`. After a job: its results, and
for a failed job the error type and message, without the folders on this computer.

## Files

Fuobe Connect keeps one file, `fuobe-connect.json`, in ComfyUI's `user` folder. The file holds the studios that you
trust and, after pairing, the studio's address, the account and the token. Only your user account can read the file:
mode 0600 on Linux and macOS, and on Windows an access list with only your account. ComfyUI does not serve this file to
web pages.

## Tests

```
python -m unittest discover -s tests
```

The tests load ComfyUI's own origin check and run it behind Fuobe Connect over real HTTP on ports 3360, 3364, 3365
and 3366. Set `FUOBE_CONNECT_TEST_PORT` to move them (the tests use that port and the three after it, +4 to +6). Set
`COMFYUI_DIR` to a ComfyUI folder to read the middleware from that copy of ComfyUI. The tests need only `aiohttp`.
They do not need models, a GPU or a running ComfyUI. The `tests` folder is not part of the published pack.

## Licence

MIT
