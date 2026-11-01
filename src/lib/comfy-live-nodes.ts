/**
 * Fuobe's live nodes for ComfyUI: one custom node file (fuobe_live.py) that live edit's graph needs
 * (src/lib/live/graph.ts). Carried here as plain ASCII, like the guard (src/lib/comfy-guard.ts): the Windows start file
 * writes it into custom_nodes, the "this computer" card and the readiness board offer it as a download, and
 * scripts/comfy/write-live-nodes.mjs writes it for the other installs.
 *
 * - LoadImageFuobeLive: a loader that reads one Fuobe-named picture from the input folder's root, without listing the
 *   whole folder on every queue (LoadImage does, which costs tenths of a second on a busy folder).
 * - CropFuobeLive: the box around a painted region (or the whole picture), so a small region is edited in detail.
 * - Qwen21ReferenceFuobeLive: the references resized and VAE-encoded in their own node, so ComfyUI keeps them cached
 *   while only the text changes.
 * - Qwen21EncodeFuobeLive: the positive prompt only (CFG 1 with BasicGuider never reads a negative).
 * - PasteBackFuobeLive: the edit composited onto the full-size base: pixels the edit didn't change are copied from the
 *   base, so they stay exactly as they were however many edits are stacked, and the edit's colour is matched to it.
 * - SaveImageFuobeLive: sends the picture over ComfyUI's socket to the client that queued it (no file, no /view), or
 *   saves it to temp.
 */

export const LIVE_NODES_FILE_NAME = "fuobe_live.py";

/** Its version, as GET /fuobe/live answers it. */
export const LIVE_NODES_VERSION = 1;

/** The node pack's name in the requirement index. */
export const LIVE_PACK = "fuobe-live";

export const LIVE_NODES_SOURCE = String.raw`"""Fuobe's live edit nodes for ComfyUI (MIT, part of Fuobe).

Live edit changes a picture as you type, with Qwen-Image 2.1 and a 2-step LoRA. These nodes keep each render small:
a loader that skips the input folder listing, a reference encode that ComfyUI caches while only the text changes, a
positive-only text encode, a crop around a painted region, a paste-back that copies unchanged pixels from the base
picture (so stacked edits don't wear the picture down), and a save node that sends the picture over the socket.
They read only Fuobe-named pictures in the input folder and send nothing anywhere but ComfyUI's own socket.
To remove them, delete this file and restart ComfyUI.
"""
import asyncio
import io
import json
import math
import os
import re
import struct
import time

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image, ImageOps

FUOBE_LIVE = ${LIVE_NODES_VERSION}
NAME = re.compile(r"^fuobe_[A-Za-z0-9_-]{8,24}\.(png|jpg|jpeg|webp)$")
MAX_REFERENCES = 4
MAX_SIDE = 4096


# ---------------------------------------------------------------------------
# Pure picture maths (torch and numpy only; scripts/comfy/test_fuobe_live.py runs them on the CPU)

def resize(img, w, h):
    """[B,H,W,C] in 0..1 to w x h (bicubic with antialiasing)."""
    if img.shape[1] == h and img.shape[2] == w:
        return img
    x = img.movedim(-1, 1)
    x = F.interpolate(x, size=(h, w), mode="bicubic", antialias=True, align_corners=False)
    return x.movedim(1, -1).clamp(0.0, 1.0)


def _gauss(x, sigma):
    """Blur a [B,1,H,W] map with a separable Gaussian."""
    if sigma <= 0:
        return x
    r = max(1, int(math.ceil(sigma * 3)))
    t = torch.arange(-r, r + 1, dtype=x.dtype, device=x.device)
    k = torch.exp(-(t * t) / (2 * sigma * sigma))
    k = k / k.sum()
    x = F.pad(x, (r, r, 0, 0), mode="replicate")
    x = F.conv2d(x, k.view(1, 1, 1, -1))
    x = F.pad(x, (0, 0, r, r), mode="replicate")
    return F.conv2d(x, k.view(1, 1, -1, 1))


def to_lab(rgb):
    """[B,H,W,3] sRGB 0..1 to CIE Lab (D65), L in 0..100."""
    c = torch.where(rgb > 0.04045, ((rgb + 0.055) / 1.055) ** 2.4, rgb / 12.92)
    m = torch.tensor([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]], dtype=rgb.dtype, device=rgb.device)
    xyz = c @ m.T
    xyz = xyz / torch.tensor([0.95047, 1.0, 1.08883], dtype=rgb.dtype, device=rgb.device)
    e = 216.0 / 24389.0
    f = torch.where(xyz > e, xyz.clamp(min=1e-8) ** (1.0 / 3.0), (24389.0 / 27.0 * xyz + 16.0) / 116.0)
    L = 116.0 * f[..., 1] - 16.0
    a = 500.0 * (f[..., 0] - f[..., 1])
    b = 200.0 * (f[..., 1] - f[..., 2])
    return torch.stack([L, a, b], dim=-1)


def from_lab(lab):
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    fy = (L + 16.0) / 116.0
    fx = fy + a / 500.0
    fz = fy - b / 200.0
    e = 216.0 / 24389.0
    k = 24389.0 / 27.0
    def inv(f):
        f3 = f ** 3
        return torch.where(f3 > e, f3, (116.0 * f - 16.0) / k)
    xyz = torch.stack([inv(fx), inv(fy), inv(fz)], dim=-1) * torch.tensor([0.95047, 1.0, 1.08883], dtype=lab.dtype, device=lab.device)
    m = torch.tensor([[3.2406, -1.5372, -0.4986], [-0.9689, 1.8758, 0.0415], [0.0557, -0.2040, 1.0570]], dtype=lab.dtype, device=lab.device)
    c = (xyz @ m.T).clamp(0.0, 1.0)
    return torch.where(c > 0.0031308, 1.055 * c.clamp(min=1e-8) ** (1.0 / 2.4) - 0.055, 12.92 * c).clamp(0.0, 1.0)


def change_mask(base, edited, threshold=0.06, feather=24, blur=5, grow=8):
    """Where the edit changed the picture: per-pixel Lab difference over threshold*100, grown and feathered. [B,H,W] 0..1."""
    d = torch.linalg.vector_norm(to_lab(base) - to_lab(edited), dim=-1)[:, None]
    d = _gauss(d, blur / 2.0)
    m = (d > threshold * 100.0).to(base.dtype)
    if grow > 0:
        m = F.max_pool2d(m, kernel_size=2 * grow + 1, stride=1, padding=grow)
    m = _gauss(m, feather / 3.0).clamp(0.0, 1.0)
    return m[:, 0]


def lab_match(edited, base, keep):
    """Move the edit's per-channel Lab mean and spread toward the base's, measured where nothing changed (keep > 0.5)."""
    sel = keep > 0.5
    if int(sel.sum()) < 64:
        return edited
    le, lb = to_lab(edited), to_lab(base)
    out = le.clone()
    for ch in range(3):
        e, b = le[..., ch][sel], lb[..., ch][sel]
        es, bs = e.std().clamp(min=1e-3), b.std().clamp(min=1e-3)
        scale = float((bs / es).clamp(0.8, 1.25))
        out[..., ch] = (le[..., ch] - e.mean()) * scale + b.mean()
    return from_lab(out)


def composite(base, edited, m):
    """base*(1-m) + edited*m. Where m is 0 the base's values come back exactly."""
    m = m[..., None].to(base.dtype)
    out = base * (1.0 - m) + edited * m
    return torch.where(m == 0, base, out)


def crop_box(mask, width, height, context=1.6, multiple=32):
    """The box (x0, y0, x1, y1) around mask > 0.5, grown by context, inside the picture and on the grid. None: no mask."""
    if mask is None:
        return (0, 0, width, height)
    ys, xs = torch.nonzero(mask > 0.5, as_tuple=True)
    if xs.numel() == 0:
        return (0, 0, width, height)
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
    w = max(multiple, (x1 - x0) * context)
    h = max(multiple, (y1 - y0) * context)
    w = min(width, int(math.ceil(w / multiple)) * multiple)
    h = min(height, int(math.ceil(h / multiple)) * multiple)
    bx0 = int(round(cx - w / 2.0))
    by0 = int(round(cy - h / 2.0))
    bx0 = max(0, min(width - w, bx0))
    by0 = max(0, min(height - h, by0))
    return (bx0, by0, bx0 + w, by0 + h)


def paste_back(base, edited, mode="auto", threshold=0.06, feather=24, match_color=True, out_max_side=0, box=None, mask=None):
    """The edit, back on the full-size base. mode auto: only what changed; mask: the painted region; off: the whole edit."""
    base = base[:1, :, :, :3]
    edited = edited[:1, :, :, :3]
    H, W = base.shape[1], base.shape[2]
    x0, y0, x1, y1 = box if box is not None else (0, 0, W, H)
    region = base[:, y0:y1, x0:x1]
    ed = resize(edited, x1 - x0, y1 - y0)
    if mode == "off":
        m = torch.ones(region.shape[:3], dtype=base.dtype, device=base.device)
        match_color = False
    elif mode == "mask" and mask is not None:
        mm = resize(mask[:1, :, :, :1].expand(1, -1, -1, 3), W, H)[..., 0]
        mm = mm[:, y0:y1, x0:x1]
        m = _gauss((mm > 0.5).to(base.dtype)[:, None], feather / 3.0)[:, 0].clamp(0.0, 1.0)
    else:
        m = change_mask(region, ed, threshold, feather)
        if float(m.mean()) > 0.6:
            m = torch.ones_like(m)
            match_color = False
    if match_color:
        ed = lab_match(ed, region, 1.0 - m)
    out = base.clone()
    out[:, y0:y1, x0:x1] = composite(region, ed, m)
    if out_max_side and max(W, H) > out_max_side:
        s = out_max_side / float(max(W, H))
        out = resize(out, max(32, int(round(W * s))), max(32, int(round(H * s))))
    return out


def encode_picture(img, fmt="webp", quality=85):
    """[1,H,W,3] 0..1 to WebP or PNG bytes."""
    arr = (img[0, :, :, :3].clamp(0.0, 1.0).cpu().numpy() * 255.0 + 0.5).astype(np.uint8)
    pil = Image.fromarray(arr)
    buf = io.BytesIO()
    if fmt == "png":
        pil.save(buf, format="PNG", compress_level=1)
        return buf.getvalue(), "image/png"
    pil.save(buf, format="WEBP", quality=int(quality), method=0)
    return buf.getvalue(), "image/webp"


def socket_payload(data, image_type, prompt_id, node_id, width, height):
    """ComfyUI's preview-with-metadata frame body (event 4): a 4-byte metadata length, the JSON, then the picture."""
    meta = json.dumps({"prompt_id": prompt_id, "node_id": node_id, "image_type": image_type, "width": width, "height": height, "fuobe_live": FUOBE_LIVE}).encode("utf-8")
    return struct.pack(">I", len(meta)) + meta + data


# ---------------------------------------------------------------------------
# The nodes (not loaded when only the maths is tested)

if not os.environ.get("FUOBE_LIVE_PURE"):
    import comfy.model_management
    import comfy.utils
    import folder_paths
    import node_helpers
    import server

    def _input_path(name):
        if not isinstance(name, str) or not NAME.match(name):
            raise ValueError("Live edit reads only pictures Fuobe sent")
        root = os.path.abspath(folder_paths.get_input_directory())
        path = os.path.abspath(os.path.join(root, name))
        if os.path.commonpath([root, path]) != root or os.path.dirname(path) != root or not os.path.isfile(path):
            raise ValueError("Live edit reads only pictures Fuobe sent")
        return path

    class LoadImageFuobeLive:
        @classmethod
        def INPUT_TYPES(cls):
            return {"required": {"image": ("STRING", {"default": "", "tooltip": "A Fuobe-named picture in the input folder."})}}

        RETURN_TYPES = ("IMAGE",)
        FUNCTION = "load"
        CATEGORY = "fuobe/live"

        @classmethod
        def IS_CHANGED(cls, image):
            try:
                st = os.stat(_input_path(image))
                return "%d-%d" % (st.st_mtime_ns, st.st_size)
            except (ValueError, OSError):
                return float("nan")

        def load(self, image):
            img = node_helpers.pillow(Image.open, _input_path(image))
            img = node_helpers.pillow(ImageOps.exif_transpose, img).convert("RGB")
            return (torch.from_numpy(np.array(img).astype(np.float32) / 255.0)[None],)

    class CropFuobeLive:
        @classmethod
        def INPUT_TYPES(cls):
            return {
                "required": {
                    "image": ("IMAGE",),
                    "context": ("FLOAT", {"default": 1.6, "min": 1.0, "max": 4.0, "step": 0.1}),
                    "multiple": ("INT", {"default": 32, "min": 8, "max": 128, "step": 8}),
                },
                "optional": {"mask_image": ("IMAGE",)},
            }

        RETURN_TYPES = ("IMAGE", "FUOBE_BOX")
        RETURN_NAMES = ("image", "box")
        FUNCTION = "crop"
        CATEGORY = "fuobe/live"

        def crop(self, image, context, multiple, mask_image=None):
            H, W = image.shape[1], image.shape[2]
            mask = None
            if mask_image is not None:
                mask = resize(mask_image[:1, :, :, :3], W, H)[0, :, :, 0]
            box = crop_box(mask, W, H, context, multiple)
            x0, y0, x1, y1 = box
            return (image[:1, y0:y1, x0:x1, :3], box)

    class Qwen21ReferenceFuobeLive:
        @classmethod
        def INPUT_TYPES(cls):
            optional = {"image_%d" % i: ("IMAGE",) for i in range(2, MAX_REFERENCES + 1)}
            return {
                "required": {"vae": ("VAE",), "resolution": ("INT", {"default": 1024, "min": 0, "max": 4096, "step": 32}), "image_1": ("IMAGE",)},
                "optional": optional,
            }

        RETURN_TYPES = ("QWEN21_REFERENCE", "IMAGE")
        RETURN_NAMES = ("reference", "image_1")
        FUNCTION = "encode"
        CATEGORY = "fuobe/live"

        def encode(self, vae, resolution, **images):
            images_vl, latents, size, first = [], [], None, None
            for name in sorted(images, key=lambda n: int(n.rsplit("_", 1)[-1])):
                image = images[name]
                if image is None:
                    continue
                samples = image[:1].movedim(-1, 1)
                if resolution > 0:
                    ratio = samples.shape[3] / samples.shape[2]
                    width = round(math.sqrt(resolution * resolution * ratio) / 32) * 32
                    height = round(math.sqrt(resolution * resolution / ratio) / 32) * 32
                else:
                    width, height = round(samples.shape[3] / 32) * 32, round(samples.shape[2] / 32) * 32
                width, height = max(32, width), max(32, height)
                if (width, height) == (samples.shape[3], samples.shape[2]):
                    s = image[:1]
                else:
                    s = comfy.utils.common_upscale(samples, width, height, "lanczos", "disabled").movedim(1, -1)
                if size is None:
                    size, first = (width, height), s
                rgb = s[:, :, :, :3]
                if s.shape[-1] > 3:
                    rgb = rgb * s[:, :, :, 3:] + (1.0 - s[:, :, :, 3:])
                images_vl.append(rgb)
                latents.append(vae.encode(s[:, :, :, :3]))
            return ({"images": images_vl, "latents": latents, "size": size}, first)

    class Qwen21EncodeFuobeLive:
        @classmethod
        def INPUT_TYPES(cls):
            return {
                "required": {
                    "clip": ("CLIP",),
                    "prompt": ("STRING", {"multiline": True}),
                    "width": ("INT", {"default": 1024, "min": 32, "max": 8192, "step": 32}),
                    "height": ("INT", {"default": 1024, "min": 32, "max": 8192, "step": 32}),
                },
                "optional": {"reference": ("QWEN21_REFERENCE",)},
            }

        RETURN_TYPES = ("CONDITIONING", "LATENT")
        RETURN_NAMES = ("positive", "latent")
        FUNCTION = "encode"
        CATEGORY = "fuobe/live"

        def encode(self, clip, prompt, width, height, reference=None):
            images_vl = reference["images"] if reference else []
            latents = reference["latents"] if reference else []
            if reference and reference["size"]:
                width, height = reference["size"]
            tokens = clip.tokenize(prompt, images=images_vl, keep_vision=not latents, prevent_empty_text=True)
            positive = clip.encode_from_tokens_scheduled(tokens)
            if latents:
                positive = node_helpers.conditioning_set_values(positive, {"reference_latents": latents}, append=True)
            latent = torch.zeros([1, 64, height // 16, width // 16], device=comfy.model_management.intermediate_device())
            return (positive, {"samples": latent})

    class PasteBackFuobeLive:
        @classmethod
        def INPUT_TYPES(cls):
            return {
                "required": {
                    "base": ("IMAGE",),
                    "edited": ("IMAGE",),
                    "mode": (["auto", "mask", "off"],),
                    "threshold": ("FLOAT", {"default": 0.06, "min": 0.0, "max": 1.0, "step": 0.01}),
                    "feather": ("INT", {"default": 24, "min": 0, "max": 256}),
                    "match_color": ("BOOLEAN", {"default": True}),
                    "out_max_side": ("INT", {"default": 0, "min": 0, "max": MAX_SIDE, "step": 32}),
                },
                "optional": {"box": ("FUOBE_BOX",), "mask_image": ("IMAGE",)},
            }

        RETURN_TYPES = ("IMAGE",)
        FUNCTION = "paste"
        CATEGORY = "fuobe/live"

        def paste(self, base, edited, mode, threshold, feather, match_color, out_max_side, box=None, mask_image=None):
            dev = comfy.model_management.intermediate_device()
            out = paste_back(base.to(dev), edited.to(dev), mode, threshold, feather, match_color, out_max_side, box, None if mask_image is None else mask_image.to(dev))
            return (out,)

    class SaveImageFuobeLive:
        @classmethod
        def INPUT_TYPES(cls):
            return {
                "required": {
                    "images": ("IMAGE",),
                    "format": (["webp", "png"],),
                    "quality": ("INT", {"default": 85, "min": 50, "max": 100}),
                    "to": (["socket", "temp"],),
                },
                "hidden": {"unique_id": "UNIQUE_ID"},
            }

        RETURN_TYPES = ()
        FUNCTION = "save"
        OUTPUT_NODE = True
        CATEGORY = "fuobe/live"

        def save(self, images, format, quality, to, unique_id=None):
            img = images[:1, :, :, :3]
            data, image_type = encode_picture(img, format, quality)
            h, w = int(img.shape[1]), int(img.shape[2])
            ps = server.PromptServer.instance
            sid = getattr(ps, "client_id", None)
            if to == "socket" and sid:
                payload = socket_payload(data, image_type, getattr(ps, "last_prompt_id", None), str(unique_id or ""), w, h)
                fut = asyncio.run_coroutine_threadsafe(ps.send_bytes(4, payload, sid=sid), ps.loop)
                try:
                    fut.result(timeout=10)
                    return {"ui": {"fuobe_live": [{"sent": True, "width": w, "height": h}]}}
                except Exception:
                    pass
            ext = "png" if format == "png" else "webp"
            name = "fuobe_live_%d_%06d.%s" % (int(time.time() * 1000), np.random.randint(0, 999999), ext)
            with open(os.path.join(folder_paths.get_temp_directory(), name), "wb") as f:
                f.write(data)
            return {"ui": {"images": [{"filename": name, "subfolder": "", "type": "temp"}]}}

    NODE_CLASS_MAPPINGS = {
        "LoadImageFuobeLive": LoadImageFuobeLive,
        "CropFuobeLive": CropFuobeLive,
        "Qwen21ReferenceFuobeLive": Qwen21ReferenceFuobeLive,
        "Qwen21EncodeFuobeLive": Qwen21EncodeFuobeLive,
        "PasteBackFuobeLive": PasteBackFuobeLive,
        "SaveImageFuobeLive": SaveImageFuobeLive,
    }
    NODE_DISPLAY_NAME_MAPPINGS = {
        "LoadImageFuobeLive": "Load Image (Fuobe live)",
        "CropFuobeLive": "Crop Around Region (Fuobe live)",
        "Qwen21ReferenceFuobeLive": "Qwen Image 2.1 Reference (Fuobe live)",
        "Qwen21EncodeFuobeLive": "Qwen Image 2.1 Encode, positive only (Fuobe live)",
        "PasteBackFuobeLive": "Paste Back Unchanged Pixels (Fuobe live)",
        "SaveImageFuobeLive": "Send Image (Fuobe live)",
    }

    async def _fuobe_live_status(request):
        from aiohttp import web
        return web.json_response({"version": FUOBE_LIVE})

    try:
        _ps = getattr(server.PromptServer, "instance", None)
        if _ps is not None:
            _ps.routes.get("/fuobe/live")(_fuobe_live_status)
    except Exception:
        pass
else:
    NODE_CLASS_MAPPINGS = {}
    NODE_DISPLAY_NAME_MAPPINGS = {}
`;

/** The nodes as base64 (the start file writes them with PowerShell). */
export function liveNodesBase64(): string {
  if (!/^[\x00-\x7f]*$/.test(LIVE_NODES_SOURCE)) throw new Error("The live nodes must be plain ASCII");
  return btoa(LIVE_NODES_SOURCE);
}

/** Its answer at /fuobe/live: there, and this version or newer. */
export const isLiveNodes = (answer: unknown): boolean => !!answer && typeof answer === "object" && Number((answer as { version?: unknown }).version) >= LIVE_NODES_VERSION;

/** The classes the file defines (the requirement index's pack). */
export const LIVE_NODE_CLASSES = ["LoadImageFuobeLive", "CropFuobeLive", "Qwen21ReferenceFuobeLive", "Qwen21EncodeFuobeLive", "PasteBackFuobeLive", "SaveImageFuobeLive"] as const;
