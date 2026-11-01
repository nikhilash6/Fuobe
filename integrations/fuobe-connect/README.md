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

Then open Fuobe in Chrome, Edge or Firefox and choose **Connect your GPU**. Your browser asks once to let the page reach
apps on this computer. Press **Allow**. Fuobe finds ComfyUI and connects.

## What it does

**Direct mode (the default).** ComfyUI turns away requests from every other website. Fuobe Connect adds one exception:
the Fuobe studios you trust (`https://fuobe.com` unless you name others). For a trusted studio it:

- answers the browser's CORS preflight and Chrome's Private Network Access preflight, for that exact origin only;
- lets through only what a Fuobe run needs: ComfyUI's facts, its model lists, its queue and history, the run's
  results, uploading the run's inputs and queueing its prompt.

A trusted studio cannot reach the Manager's install calls, your user files, your settings or your input folder. Every
other website still meets ComfyUI's own check, unchanged. Nothing in ComfyUI's own files changes.

If ComfyUI runs with `--enable-cors-header` (an older Fuobe setup), ComfyUI's own check is off. Fuobe Connect then also
turns away every website except ComfyUI's own page, the site that the setting names and the trusted studios. This is
what Fuobe's guard file did, so you can delete `fuobe_guard.py` and the setting.

**Pairing mode (for Safari, phones and PCs with no screen).** Some browsers do not let a website reach apps on your
computer. In ComfyUI, open **Extensions → Connect to Fuobe** and press **Connect**. ComfyUI shows a short code. Open the
link on any device, sign in to Fuobe and approve the code. From then on, ComfyUI gets that one person's jobs from the
studio over HTTPS, and it runs them with no Fuobe tab open. It opens no port. The token belongs to you alone, so another
person's jobs never reach your PC. To stop, press **Disconnect** in the same window, or remove the computer in Fuobe's
settings.

On a PC with no screen, start ComfyUI with `FUOBE_CONNECT_PAIR=1`. The code and the link then appear in ComfyUI's
console.

## Your own Fuobe studio

To use a studio that you host yourself, open ComfyUI's **Settings → Fuobe Connect** and enter its address, for example
`https://studio.example.com`. You can also set the environment variable
`FUOBE_CONNECT_ORIGINS=https://studio.example.com` before you start ComfyUI. Separate several studios with commas. The
first one is also the studio that pairing uses.

## Files

Fuobe Connect keeps one file, `fuobe-connect.json`, in ComfyUI's `user` folder. The file holds the studios that you
trust and, after pairing, the studio's address and the token. Only your user account can read the file. ComfyUI does
not serve this file to web pages.

## Tests

```
python -m unittest discover -s tests
```

The tests load ComfyUI's own origin check and run it behind Fuobe Connect over real HTTP on port 3360. Set
`FUOBE_CONNECT_TEST_PORT` to choose another port. Set `COMFYUI_DIR` to a ComfyUI folder to read the middleware from that
copy of ComfyUI. The tests need only `aiohttp`. They do not need models, a GPU or a running ComfyUI.

## Licence

MIT
