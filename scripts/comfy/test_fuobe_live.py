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

# A global change (over 60 %) takes the whole edit.
glob = (base * 0.5).clamp(0, 1)
out2 = fl.paste_back(base, glob, "auto", 0.06, 8, True, 0)
check("a global edit replaces the picture", float((out2 - glob).abs().max()) < 1e-5)

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
