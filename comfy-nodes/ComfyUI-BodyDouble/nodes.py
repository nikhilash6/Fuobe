"""Body Double nodes.

BodyDoubleFit: moves each body (MHR_POSE_DATA, as ComfyUI-InstantHMR and SAM 3D Body give it) so that its 3D
keypoints land on its own 2D keypoints in the picture. The network's camera translation alone can leave the body a
few percent off and too small or too large; three unknowns per body, solved by Gauss-Newton.

BodyDoubleLook: draws every person's double in a look, over their whole outline (clothes and hair included): the
people's mask filled from the picture's own geometry (MoGe normals and depth), or the SCAIL skeleton render.
"""

import numpy as np
import torch
import torch.nn.functional as F

from comfy_api.latest import io

MHRPoseData = io.Custom("MHR_POSE_DATA")

# Body, wrist and head keypoints of the 70: finger tips swing far and their 2D estimate is the loosest.
FIT_KEYPOINTS = list(range(0, 21)) + [41, 62, 69]
LOOKS = ["holo", "clay", "thermal", "ghost", "xray", "skeleton"]
# Where the clay look's light comes from, in normal-map space (x right, y up, z toward the viewer): above left, in front.
CLAY_LIGHT = (-0.45, 0.55, 0.70)
CLAY_COLOUR = (0.88, 0.85, 0.82)


def fit_translation(kp3d, kp2d, t0, focal, cx, cy, iters=8):
    """The camera translation that projects kp3d (body frame, metres) onto kp2d (pixels). Returns (t, fitted)."""
    t = np.asarray(t0, dtype=np.float64).copy()
    j3 = np.asarray(kp3d, dtype=np.float64)[FIT_KEYPOINTS]
    j2 = np.asarray(kp2d, dtype=np.float64)[FIT_KEYPOINTS]
    n = len(j3)
    for _ in range(iters):
        p = j3 + t
        z = np.maximum(p[:, 2], 0.1)
        r = np.concatenate([focal * p[:, 0] / z + cx - j2[:, 0], focal * p[:, 1] / z + cy - j2[:, 1]])
        jac = np.zeros((2 * n, 3))
        jac[:n, 0] = focal / z
        jac[:n, 2] = -focal * p[:, 0] / z**2
        jac[n:, 1] = focal / z
        jac[n:, 2] = -focal * p[:, 1] / z**2
        d, *_ = np.linalg.lstsq(jac, -r, rcond=None)
        t += d
    t0 = np.asarray(t0, dtype=np.float64)
    # Keypoints off the person make the fit run away: keep the network's answer then.
    if not np.all(np.isfinite(t)) or not 0.3 < t[2] < 50 or abs(t[2] - t0[2]) > 0.5 * abs(t0[2]):
        return t0.astype(np.float32), False
    return t.astype(np.float32), True


class BodyDoubleFit(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="BodyDoubleFit",
            display_name="Body Double Fit",
            category="image/detection",
            description="Line each body up with its person: its 3D keypoints are moved onto its 2D keypoints.",
            inputs=[MHRPoseData.Input("mhr_pose_data")],
            outputs=[MHRPoseData.Output("mhr_pose_data")],
        )

    @classmethod
    def execute(cls, mhr_pose_data) -> io.NodeOutput:
        data = dict(mhr_pose_data)
        h, w = data["image_size"]
        frames = []
        for people in data["frames"]:
            fitted = []
            for person in people:
                person = dict(person)
                t, ok = fit_translation(person["pred_keypoints_3d"], person["pred_keypoints_2d"], person["pred_cam_t"],
                                        float(person["focal_length"]), w / 2, h / 2)
                if ok:
                    person["pred_cam_t"] = t
                fitted.append(person)
            frames.append(fitted)
        data["frames"] = frames
        return io.NodeOutput(data)


def _fit(t, h, w):
    """An IMAGE [B, h', w', C] or MASK [B, h', w'] at h x w."""
    if t.shape[1] == h and t.shape[2] == w:
        return t
    if t.ndim == 3:
        return F.interpolate(t[:, None], size=(h, w), mode="bilinear", align_corners=False)[:, 0]
    return F.interpolate(t.movedim(-1, 1), size=(h, w), mode="bilinear", align_corners=False).movedim(1, -1)


def _turbo(x):
    """Google's Turbo colour map (polynomial fit), x in 0-1 → RGB in 0-1."""
    x = x.clamp(0, 1)
    r = 0.13572138 + x * (4.61539260 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))))
    g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))))
    b = 0.10667330 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))))
    return torch.stack([r, g, b], -1).clamp(0, 1)


def _nearness(depth, mask):
    """MoGe's depth render (near is bright) stretched to 0-1 over the people, with one range for the whole clip."""
    d = depth[..., 0]
    inside = d[mask > 0.5]
    if inside.numel() < 16:
        return d
    lo, hi = torch.quantile(inside.float(), torch.tensor([0.02, 0.98], device=d.device, dtype=torch.float32))
    return ((d - lo) / (hi - lo).clamp_min(1e-4)).clamp(0, 1)


class BodyDoubleLook(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="BodyDoubleLook",
            display_name="Body Double Look",
            category="image",
            description="Every person's double over their whole outline, clothes and hair included, in one look.",
            inputs=[
                io.Image.Input("image"),
                io.Mask.Input("mask", tooltip="The people: SAM 3 masks, one per frame"),
                io.Combo.Input("look", options=LOOKS, default="holo"),
                io.Image.Input("normals", optional=True, tooltip="MoGe normal map (OpenGL) of the same frames"),
                io.Image.Input("depth", optional=True, tooltip="MoGe depth render of the same frames (near is bright)"),
                io.Image.Input("skeleton", optional=True, tooltip="The SCAIL skeleton drawn over the frames"),
                io.Float.Input("feather", default=1.5, min=0.0, max=16.0, step=0.5, advanced=True, tooltip="Soft edge of the outline, px"),
            ],
            outputs=[io.Image.Output("image")],
        )

    @classmethod
    def execute(cls, image, mask, look="holo", normals=None, depth=None, skeleton=None, feather=1.5) -> io.NodeOutput:
        b, h, w, _ = image.shape
        if look == "skeleton":
            return io.NodeOutput(_fit(skeleton, h, w) if skeleton is not None else image)
        m = _fit(mask.float(), h, w)
        if m.shape[0] == 1 and b > 1:
            m = m.expand(b, h, w)
        if feather > 0:
            k = int(feather * 2) * 2 + 1
            m = F.avg_pool2d(m[:, None], k, stride=1, padding=k // 2)[:, 0]
        if look in ("thermal", "xray"):
            if depth is None or normals is None:
                raise ValueError(f"The {look} look needs the depth and normals inputs")
            near = _nearness(_fit(depth.float(), h, w), m)
            # How much each point faces the camera (normal-map z): 1 facing it, 0 at the outline.
            facing = (_fit(normals.float(), h, w)[..., 2] * 2 - 1).clamp(0, 1)
            if look == "thermal":
                # Warmest where the body is nearest and faces the camera, cooling toward the outline.
                fill = _turbo(0.08 + 0.9 * (0.4 * near + 0.6 * facing**2))
            else:
                # Bright rims where the surface turns away, a faint body glow inside: an X-ray of the outline.
                rim = (1 - facing).clamp(0, 1)
                glow = (0.30 + 0.15 * near + 0.75 * rim**1.2).clamp(0, 1)
                fill = (glow[..., None] * torch.tensor((0.55, 0.88, 1.0)) + (rim**4 * 0.6)[..., None]).clamp(0, 1)
            alpha = 0.95
        else:
            if normals is None:
                raise ValueError(f"The {look} look needs the normals input")
            nrm = _fit(normals.float(), h, w)
            if look == "clay":
                n = F.normalize(nrm * 2 - 1, dim=-1)
                light = F.normalize(torch.tensor(CLAY_LIGHT), dim=0)
                shade = 0.22 + 0.78 * (n * light).sum(-1).clamp(0, 1)
                fill = shade[..., None] * torch.tensor(CLAY_COLOUR)
                alpha = 1.0
            else:
                fill = nrm
                alpha = 0.5 if look == "ghost" else 1.0
        a = (m * alpha)[..., None]
        return io.NodeOutput((image[..., :3] * (1 - a) + fill.to(image) * a).clamp(0, 1))


NODES = [BodyDoubleFit, BodyDoubleLook]
