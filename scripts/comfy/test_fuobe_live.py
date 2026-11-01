"""CPU checks of the picture maths in Fuobe's live nodes (fuobe_live.py). No ComfyUI server, no GPU.

    node scripts/comfy/write-live-nodes.mjs <dir>
    CUDA_VISIBLE_DEVICES= FUOBE_LIVE_PURE=1 <ComfyUI's python> -I scripts/comfy/test_fuobe_live.py <dir> [fixture.bin]

<dir> holds fuobe_live.py. With fixture.bin, the type-4 socket frame body is written there for the TypeScript parser's
test (tests/fixtures/live-type4.bin).
"""
import importlib.util
import os
import sys

os.environ["FUOBE_LIVE_PURE"] = "1"
import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402

here = sys.argv[1]
spec = importlib.util.spec_from_file_location("fuobe_live", os.path.join(here, "fuobe_live.py"))
fl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fl)

failed = []


def check(name, ok):
    print(("ok   " if ok else "FAIL ") + name)
    if not ok:
        failed.append(name)


torch.manual_seed(0)
H, W = 256, 192
base = (torch.rand(1, H, W, 3) * 255).round() / 255.0
edited = base.clone()
edited[:, 40:100, 50:120] = torch.tensor([0.9, 0.1, 0.1])

# change_mask finds the edited rectangle, not the rest.
m = fl.change_mask(base, edited, 0.06, 8)
check("change_mask covers the edit", float(m[0, 60:80, 70:100].min()) > 0.9)
check("change_mask leaves far pixels alone", float(m[0, 200:, :].max()) == 0.0)

# lab_match moves the mean toward the base on the kept region.
shifted = (base * 0.8 + 0.15).clamp(0, 1)
keep = torch.ones(1, H, W)
matched = fl.lab_match(shifted, base, keep)
before = float((fl.to_lab(shifted) - fl.to_lab(base))[..., 0].mean().abs())
after = float((fl.to_lab(matched) - fl.to_lab(base))[..., 0].mean().abs())
check("lab_match moves the mean toward the base", after < before * 0.5)

# composite keeps the outside bytes exactly.
out = fl.paste_back(base, edited, "auto", 0.06, 8, True, 0)
u8 = lambda t: (t.clamp(0, 1) * 255 + 0.5).to(torch.uint8)
check("paste_back keeps untouched pixels bit-identical", bool(torch.equal(u8(out)[0, 200:], u8(base)[0, 200:])))
check("paste_back carries the edit", float((out[0, 60:80, 70:100] - base[0, 60:80, 70:100]).abs().mean()) > 0.1)

# A global change (over 60 %) takes the whole edit's light and colour; the base's detail stays where the structure did.
glob = (base * 0.5).clamp(0, 1)
out2 = fl.paste_back(base, glob, "auto", 0.06, 8, True, 0)
check("a global edit takes the edit's light", abs(float(out2.mean() - glob.mean())) < 0.01)
check("without detail, a global edit is the edit", float((fl.paste_back(base, glob, "auto", 0.06, 8, True, 0, None, None, False) - glob).abs().max()) < 1e-5)

# The edit made smaller (a live frame) is scaled to the base, and out_max_side downscales the composite.
small = fl.resize(edited, W // 2, H // 2)
out3 = fl.paste_back(base, small, "auto", 0.06, 8, True, 128)
check("out_max_side downscales", max(out3.shape[1], out3.shape[2]) == 128)

# crop_box: inside the picture and on the grid.
mask = torch.zeros(H, W)
mask[100:120, 150:180] = 1
box = fl.crop_box(mask, W, H, 1.6, 32)
x0, y0, x1, y1 = box
check("crop_box inside the picture", 0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H)
check("crop_box on the grid", (x1 - x0) % 32 == 0 and (y1 - y0) % 32 == 0)
check("crop_box holds the mask", x0 <= 150 and x1 >= 180 and y0 <= 100 and y1 >= 120)
check("crop_box without a mask is the picture", fl.crop_box(None, W, H) == (0, 0, W, H))

# mask mode: outside the feathered mask, the base comes back exactly.
mimg = torch.zeros(1, H, W, 3)
mimg[:, 100:120, 150:180] = 1
crop = base[:, y0:y1, x0:x1]
ed_crop = crop.clone() * 0.3
out4 = fl.paste_back(base, ed_crop, "mask", 0.06, 6, False, 0, box, mimg)
check("mask mode keeps pixels outside the box", bool(torch.equal(u8(out4)[0, :y0], u8(base)[0, :y0])))
check("mask mode keeps pixels far from the mask inside the box", bool(torch.equal(u8(out4)[0, y0:y0 + 2, x0:x0 + 2], u8(base)[0, y0:y0 + 2, x0:x0 + 2])))

# ---------------------------------------------------------------------------
# Real renders: a 1024 edit of a 2048 master (half the size), with VAE-like noise and blur over the whole frame.

H2, W2 = 512, 384
yy, xx = torch.meshgrid(torch.linspace(0, 1, H2), torch.linspace(0, 1, W2), indexing="ij")
img = torch.stack([0.3 + 0.4 * xx, 0.25 + 0.5 * yy, 0.5 + 0.2 * torch.sin(6 * xx + 3 * yy)], -1)
for (cy, cx, r, col) in [(0.3, 0.4, 0.15, (0.8, 0.6, 0.5)), (0.7, 0.6, 0.12, (0.2, 0.3, 0.6)), (0.5, 0.2, 0.08, (0.9, 0.9, 0.85))]:
    dist = ((yy - cy) ** 2 + ((xx - cx) * W2 / H2) ** 2).sqrt()
    img = torch.where((dist < r)[..., None], torch.tensor(col), img)
tex = fl._gauss(torch.randn(1, 1, H2, W2), 0.8)[0, 0]
img = (img + (tex / tex.std() * 0.05)[..., None]).clamp(0, 1)
photo = ((img * 255).round() / 255.0)[None]


def render(x, seed):
    """x made at half its size, with +-2/255 noise and a slight blur: what comes back from the model and its VAE."""
    g = torch.Generator().manual_seed(seed)
    s = fl.resize(x, x.shape[2] // 2, x.shape[1] // 2)
    s = s + torch.randint(-2, 3, s.shape, generator=g).float() / 255.0
    return fl._blur_img(s, 0.5).clamp(0, 1)


def luma_hp(x):
    return fl.luma(x - fl._blur_img(x, 1.0))


def lapvar(x):
    k = torch.tensor([[0.0, 1.0, 0.0], [1.0, -4.0, 1.0], [0.0, 1.0, 0.0]]).view(1, 1, 3, 3)
    return float(F.conv2d(fl.luma(x), k).var())


def ssim(a, b):
    a, b = fl.luma(a), fl.luma(b)
    g = lambda t: F.avg_pool2d(t, 8, 8)
    ma, mb = g(a), g(b)
    va, vb, cov = g(a * a) - ma * ma, g(b * b) - mb * mb, g(a * b) - ma * mb
    return float((((2 * ma * mb + 1e-4) * (2 * cov + 9e-4)) / ((ma ** 2 + mb ** 2 + 1e-4) * (va + vb + 9e-4))).mean())


def corr(a, b):
    a, b = a - a.mean(), b - b.mean()
    return float((a * b).sum() / ((a * a).sum() * (b * b).sum()).sqrt())


# A local change on a whole-frame lossy render: the mask stays local, and untouched pixels stay bit-identical.
e = render(photo, 1)
e[:, 60:110, 40:100] = torch.tensor([0.9, 0.1, 0.1])
m = fl.change_mask(fl.resize(photo, e.shape[2], e.shape[1]), e)
check("a lossy render's mask stays local (%.3f of the picture)" % float(m.mean()), float(m.mean()) < 0.2)
out5 = fl.paste_back(photo, e, "auto", 0.06, 24, True, 0)
same = float((u8(out5) == u8(photo)).all(-1).float().mean())
check("a lossy render leaves %.1f %% of pixels bit-identical" % (same * 100), same > 0.85)
check("far from the change, every pixel is the base's", bool(torch.equal(u8(out5)[0, 300:], u8(photo)[0, 300:])))
check("the local change is carried", float((out5[0, 140:200, 100:180] - photo[0, 140:200, 100:180]).abs().mean()) > 0.2)

# 10 stacked global grades (warm, then cool): the picture keeps its sharpness and structure. Without the detail
# transfer it doesn't (the reason for it).
def grade(x, k):
    f = torch.tensor([1.15, 1.02, 0.85])
    return ((x * f) if k % 2 == 0 else (x / f)).clamp(0, 1) ** (0.97 if k % 2 == 0 else 1 / 0.97)


scores = {}
for detail in (True, False):
    cur, ref = photo.clone(), photo.clone()
    for k in range(10):
        ref = grade(ref, k)
        cur = fl.paste_back(cur, render(grade(cur, k), 100 + k), "auto", 0.06, 24, True, 0, None, None, detail)
        cur = u8(cur).float() / 255.0
    scores[detail] = (lapvar(cur) / lapvar(ref), ssim(cur, ref))
print("     10 global edits: sharpness %.3f, SSIM %.4f (without detail transfer: %.3f, %.4f)" % (scores[True] + scores[False]))
check("10 global edits keep 90 %% of the sharpness", scores[True][0] >= 0.9)
check("10 global edits keep SSIM 0.98 against the ideal grade", scores[True][1] >= 0.98)
check("without detail transfer they don't", scores[False][0] < 0.5 and scores[False][1] < 0.9)

# A style edit (new texture, new colour) keeps its own texture, not the base's.
small = fl.resize(photo, W2 // 2, H2 // 2)
nt = fl._gauss(torch.randn(1, 1, H2 // 2, W2 // 2), 0.6)[0, 0]
style = ((fl._blur_img(small, 2.0) + (nt / nt.std() * 0.06)[..., None]) * torch.tensor([1.2, 0.9, 0.7])).clamp(0, 1)
out6 = fl.paste_back(photo, style, "auto", 0.06, 24, True, 0)
c_edit, c_base = corr(luma_hp(out6), luma_hp(fl.resize(style, W2, H2))), corr(luma_hp(out6), luma_hp(photo))
check("a style edit keeps its own texture (%.3f against %.3f)" % (c_edit, c_base), c_edit > 0.9 and c_base < 0.2)

# The save node is never served from ComfyUI's cache, and /fuobe/live reports this file's hash.
src = open(os.path.join(here, "fuobe_live.py"), "rb").read()
check("the save node always runs", b'def IS_CHANGED(cls, **kwargs):' in src and b'return float("nan")' in src)
import hashlib  # noqa: E402
check("the module hashes its own file", fl.FUOBE_LIVE_SHA256 == hashlib.sha256(src).hexdigest())

# The socket frame body.
data, kind = fl.encode_picture(base, "webp", 85)
check("encode webp", kind == "image/webp" and data[:4] == b"RIFF")
png, kind2 = fl.encode_picture(base, "png")
check("encode png", kind2 == "image/png" and png[:4] == b"\x89PNG")
body = fl.socket_payload(data, kind, "11111111-2222-4333-8444-555555555555", "90", W, H)
if len(sys.argv) > 2:
    with open(sys.argv[2], "wb") as f:
        f.write(b"\x00\x00\x00\x04" + body)

print("%d failed" % len(failed))
sys.exit(1 if failed else 0)
