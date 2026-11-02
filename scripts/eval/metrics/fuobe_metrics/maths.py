"""The metric maths, on plain numpy arrays (embeddings, frames, flows, audio), so it is tested
without any model. The model wrappers in models.py only turn media into these arrays."""

from __future__ import annotations

import numpy as np


def l2norm(x: np.ndarray, axis: int = -1) -> np.ndarray:
    x = np.asarray(x, dtype=np.float64)
    n = np.linalg.norm(x, axis=axis, keepdims=True)
    return x / np.where(n == 0, 1, n)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    """Cosine similarity of two vectors (0 when either is all zeros)."""
    return float(np.dot(l2norm(a), l2norm(b)))


def clip_score(image_emb: np.ndarray, text_emb: np.ndarray) -> float:
    """CLIPScore as torchmetrics defines it: 100 * max(cos(image, text), 0). Higher follows the prompt better."""
    return 100.0 * max(cosine(image_emb, text_emb), 0.0)


def mean_clip_score(image_embs: np.ndarray, text_emb: np.ndarray) -> float:
    """A clip's score is the mean over its sampled frames."""
    return float(np.mean([clip_score(e, text_emb) for e in np.atleast_2d(image_embs)]))


def reference_similarity(emb: np.ndarray, refs: np.ndarray) -> dict:
    """How close an output is to a reference set: to the set's centroid and to its nearest member."""
    refs = l2norm(np.atleast_2d(refs))
    e = l2norm(emb)
    centroid = l2norm(refs.mean(axis=0))
    sims = refs @ e
    return {"centroid": float(centroid @ e), "nearest": float(sims.max()), "n": int(len(refs))}


def drift(frame_embs: np.ndarray) -> dict:
    """Frame-to-frame embedding drift: 1 - cos between consecutive frames (0 = no change). Lower is steadier."""
    e = l2norm(np.atleast_2d(frame_embs))
    if len(e) < 2:
        return {"mean": 0.0, "max": 0.0, "pairs": 0}
    d = 1.0 - np.sum(e[1:] * e[:-1], axis=1)
    d = np.clip(d, 0.0, 2.0)
    return {"mean": float(d.mean()), "max": float(d.max()), "pairs": int(len(d))}


def warp_backward(image: np.ndarray, flow: np.ndarray) -> np.ndarray:
    """Sample `image` (H×W×C, float) at x + flow(x) with bilinear interpolation (edges clamped)."""
    h, w = image.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float64)
    x = np.clip(xs + flow[..., 0], 0, w - 1)
    y = np.clip(ys + flow[..., 1], 0, h - 1)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    wx = (x - x0)[..., None]
    wy = (y - y0)[..., None]
    img = image if image.ndim == 3 else image[..., None]
    top = img[y0, x0] * (1 - wx) + img[y0, x1] * wx
    bottom = img[y1, x0] * (1 - wx) + img[y1, x1] * wx
    out = top * (1 - wy) + bottom * wy
    return out if image.ndim == 3 else out[..., 0]


def valid_flow_mask(flow_fw: np.ndarray, flow_bw: np.ndarray, alpha: float = 0.01, beta: float = 0.5) -> np.ndarray:
    """Forward-backward consistency (Sundaram et al. 2010): pixels whose flow round trip doesn't come back are occluded."""
    bw_at = warp_backward(flow_bw, flow_fw)
    diff = np.sum((flow_fw + bw_at) ** 2, axis=-1)
    bound = alpha * (np.sum(flow_fw**2, axis=-1) + np.sum(bw_at**2, axis=-1)) + beta
    h, w = flow_fw.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    inside = (xs + flow_fw[..., 0] >= 0) & (xs + flow_fw[..., 0] <= w - 1) & (ys + flow_fw[..., 1] >= 0) & (ys + flow_fw[..., 1] <= h - 1)
    return (diff <= bound) & inside


def warp_error(frame0: np.ndarray, frame1: np.ndarray, flow: np.ndarray, mask: np.ndarray | None = None) -> float:
    """
    Mean absolute photometric error (0–1) between frame0 and frame1 warped back along the flow
    frame0 → frame1, over the pixels in `mask`. Flicker and texture boiling raise it; real motion
    that the flow follows doesn't.
    """
    a = np.asarray(frame0, dtype=np.float64)
    b = warp_backward(np.asarray(frame1, dtype=np.float64), flow)
    err = np.abs(a - b)
    if err.ndim == 3:
        err = err.mean(axis=-1)
    if a.max() > 1.5:
        err = err / 255.0
    if mask is not None:
        if not mask.any():
            return float("nan")
        return float(err[mask].mean())
    return float(err.mean())


def frame_envelope(audio: np.ndarray, sr: int, fps: float, frames: int) -> np.ndarray:
    """The audio's RMS loudness for each video frame (frames values)."""
    audio = np.asarray(audio, dtype=np.float64)
    hop = sr / fps
    out = np.zeros(frames)
    for i in range(frames):
        a = int(round(i * hop))
        b = int(round((i + 1) * hop))
        seg = audio[a:b]
        out[i] = float(np.sqrt(np.mean(seg**2))) if len(seg) else 0.0
    return out


def motion_energy(frames: np.ndarray) -> np.ndarray:
    """Mean absolute change of a region between consecutive frames (len(frames) values; the first copies the second)."""
    f = np.asarray(frames, dtype=np.float64)
    if len(f) < 2:
        return np.zeros(len(f))
    d = np.abs(np.diff(f, axis=0)).reshape(len(f) - 1, -1).mean(axis=1)
    return np.concatenate([[d[0]], d])


def best_lag_correlation(a: np.ndarray, b: np.ndarray, max_lag: int) -> dict:
    """
    The Pearson correlation of two series at the lag (b shifted by -max_lag..max_lag samples) where it
    is highest. A lip-sync proxy: the mouth region's motion against the voice's loudness, with the
    lag as the audio/video offset in frames.
    """
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    n = min(len(a), len(b))
    a, b = a[:n], b[:n]
    best = {"corr": 0.0, "lag": 0, "overlap": 0}
    for lag in range(-max_lag, max_lag + 1):
        x = a[max(0, lag) : n + min(0, lag)]
        y = b[max(0, -lag) : n - max(0, lag)]
        if len(x) < 4 or x.std() == 0 or y.std() == 0:
            continue
        r = float(np.corrcoef(x, y)[0, 1])
        if r > best["corr"]:
            best = {"corr": r, "lag": lag, "overlap": int(len(x))}
    return best


def ring_mask(h: int, w: int, frac: float = 0.15) -> np.ndarray:
    """True on the frame's outer ring (`frac` of each side): where the background is, around a person in the middle."""
    m = np.zeros((h, w), dtype=bool)
    dy, dx = max(1, int(round(h * frac))), max(1, int(round(w * frac)))
    m[:dy, :] = m[-dy:, :] = True
    m[:, :dx] = m[:, -dx:] = True
    return m


def background_difference(out: np.ndarray, src: np.ndarray, frac: float = 0.15) -> dict:
    """How far a clip's background moved from the source's: mean abs error (0–1) and PSNR (dB) on the outer ring of
    each frame, over the frames both have (uint8 N×H×W×3, the same size)."""
    n = min(len(out), len(src))
    if n == 0:
        return {"mae": float("nan"), "psnr": float("nan"), "frames": 0}
    a = out[:n].astype(np.float32) / 255.0
    b = src[:n].astype(np.float32) / 255.0
    ring = ring_mask(a.shape[1], a.shape[2], frac)
    diff = (a - b)[:, ring]
    mse = float(np.mean(diff**2))
    return {"mae": float(np.mean(np.abs(diff))), "psnr": 99.0 if mse <= 1e-10 else float(10 * np.log10(1.0 / mse)), "frames": n}


def consecutive_similarity(embs: np.ndarray) -> float:
    """Mean cosine between consecutive items (the shots of a film): how well a look and its subject carry across cuts."""
    e = l2norm(np.atleast_2d(embs))
    if len(e) < 2:
        return float("nan")
    return float(np.mean(np.sum(e[1:] * e[:-1], axis=1)))


def yunet_face(row, scale: float = 1.0) -> dict:
    """One row of OpenCV's FaceDetectorYN (x, y, w, h, 5 landmarks, score) found on a picture resized by `scale`,
    in the original picture's pixels: {box: [x0, y0, x1, y1], kps: 5×2, score}. YuNet lists the subject's right
    eye, left eye, nose tip, right and left mouth corners: in the picture, left to right as ArcFace's template
    (and insightface's kps) expects them."""
    r = np.asarray(row, dtype=np.float64)
    x, y, w, h = r[:4] / scale
    return {"box": [float(x), float(y), float(x + w), float(y + h)], "kps": (r[4:14] / scale).reshape(5, 2), "score": float(r[14])}


def hex_colors(colors) -> np.ndarray:
    """'#RRGGBB' strings as a K×3 uint8 array (anything else is left out)."""
    out = []
    for c in colors or []:
        h = str(c).strip().lstrip("#")
        if len(h) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in h):
            out.append([int(h[i : i + 2], 16) for i in (0, 2, 4)])
    return np.array(out, dtype=np.uint8).reshape(-1, 3)


def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB 0–255 (…×3) to CIE L*a*b* under D65."""
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = (lin @ m.T) / np.array([0.95047, 1.0, 1.08883])
    eps, kappa = 216 / 24389, 24389 / 27
    f = np.where(xyz > eps, np.cbrt(xyz), (kappa * xyz + 16) / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def palette_fit(pixels: np.ndarray, palette: np.ndarray, used: float = 0.03) -> dict:
    """How closely a picture keeps to a palette (Soul HEX): `fit`, the mean ΔE (CIE76) from each pixel to its nearest
    palette colour (lower is closer; about 2.3 is a just-noticeable difference), and `cover`, the share of the palette's
    colours that are the nearest one for at least `used` of the pixels (a picture in one of five colours covers 0.2)."""
    px = srgb_to_lab(np.asarray(pixels).reshape(-1, 3))
    pal = srgb_to_lab(np.asarray(palette).reshape(-1, 3))
    if not len(px) or not len(pal):
        return {"fit": float("nan"), "cover": float("nan")}
    d = np.linalg.norm(px[:, None, :] - pal[None, :, :], axis=-1)
    share = np.bincount(d.argmin(axis=1), minlength=len(pal)) / len(px)
    return {"fit": float(d.min(axis=1).mean()), "cover": float(np.mean(share >= used))}
