"""The metric maths on tiny synthetic inputs (numpy only, no model)."""

import math

import numpy as np
import pytest

from fuobe_metrics import maths


def test_cosine_and_clip_score():
    a = np.array([1.0, 0.0, 0.0])
    assert maths.cosine(a, a) == pytest.approx(1.0)
    assert maths.cosine(a, np.array([0.0, 1.0, 0.0])) == pytest.approx(0.0)
    assert maths.cosine(a, np.zeros(3)) == 0.0
    # CLIPScore is 100·cos, and never negative.
    assert maths.clip_score(np.array([3.0, 4.0]), np.array([3.0, 4.0])) == pytest.approx(100.0)
    assert maths.clip_score(np.array([1.0, 0.0]), np.array([-1.0, 0.0])) == 0.0
    frames = np.array([[1.0, 0.0], [0.0, 1.0]])
    assert maths.mean_clip_score(frames, np.array([1.0, 0.0])) == pytest.approx(50.0)


def test_reference_similarity_centroid_and_nearest():
    refs = np.array([[1.0, 0.0], [0.0, 1.0]])
    s = maths.reference_similarity(np.array([1.0, 1.0]), refs)
    assert s["centroid"] == pytest.approx(1.0)
    assert s["nearest"] == pytest.approx(math.sqrt(0.5))
    assert s["n"] == 2
    far = maths.reference_similarity(np.array([-1.0, -1.0]), refs)
    assert far["centroid"] == pytest.approx(-1.0)


def test_drift_is_zero_for_a_still_and_grows_with_change():
    still = np.tile([[0.2, 0.9, 0.1]], (6, 1))
    assert maths.drift(still) == {"mean": pytest.approx(0.0), "max": pytest.approx(0.0), "pairs": 5}
    rng = np.random.default_rng(0)
    shaky = rng.normal(size=(6, 32))
    d = maths.drift(shaky)
    assert d["mean"] > 0.5 and d["max"] >= d["mean"]
    assert maths.drift(np.ones((1, 3)))["pairs"] == 0


def _texture(h=48, w=64, seed=1):
    rng = np.random.default_rng(seed)
    base = rng.random((h // 4, w // 4))
    return np.kron(base, np.ones((4, 4)))  # blocky, so a 2-pixel shift is exact to interpolate


def test_warp_error_is_near_zero_when_the_flow_explains_the_motion():
    f0 = _texture()
    f1 = np.roll(f0, 2, axis=1)  # everything moves 2 px right
    flow = np.zeros(f0.shape + (2,))
    flow[..., 0] = 2.0
    inside = np.zeros(f0.shape, bool)
    inside[:, 2:-2] = True
    assert maths.warp_error(f0, f1, flow, inside) == pytest.approx(0.0, abs=1e-9)
    # With no flow, the same motion counts as error; flicker (new noise) counts even with the right flow.
    assert maths.warp_error(f0, f1, np.zeros_like(flow), inside) > 0.1
    flicker = f1 + np.random.default_rng(2).normal(0, 0.2, f1.shape)
    assert maths.warp_error(f0, flicker, flow, inside) > 0.1
    # 0–255 frames are put on the same 0–1 scale.
    assert maths.warp_error(f0 * 255, f1 * 255, np.zeros_like(flow), inside) == pytest.approx(maths.warp_error(f0, f1, np.zeros_like(flow), inside))
    assert math.isnan(maths.warp_error(f0, f1, flow, np.zeros(f0.shape, bool)))


def test_valid_flow_mask_keeps_consistent_pixels_and_drops_ones_that_leave_the_frame():
    h, w = 20, 30
    fw = np.zeros((h, w, 2))
    fw[..., 0] = 3.0
    bw = -fw
    mask = maths.valid_flow_mask(fw, bw)
    assert mask[:, : w - 3].all()
    assert not mask[:, w - 2 :].any()
    # A backward flow that doesn't undo the forward one marks the pixels occluded.
    assert not maths.valid_flow_mask(fw, np.zeros_like(fw))[:, :10].any()


def test_lip_sync_proxy_finds_the_offset_between_mouth_motion_and_voice():
    fps, sr, n = 25, 16000, 100
    t = np.arange(n * sr // fps) / sr
    syllables = (np.sin(2 * np.pi * 3 * t) > 0.3).astype(float)
    audio = syllables * np.sin(2 * np.pi * 200 * t)
    env = maths.frame_envelope(audio, sr, fps, n)
    assert env.shape == (n,) and env.max() > 0.5 and env.min() == 0.0
    # A mouth that opens with the voice, two frames late.
    mouth = np.roll(env, 2) + np.random.default_rng(3).normal(0, 0.02, n)
    best = maths.best_lag_correlation(mouth, env, max_lag=5)
    assert best["lag"] == 2 and best["corr"] > 0.9
    unrelated = np.random.default_rng(4).random(n)
    assert maths.best_lag_correlation(unrelated, env, max_lag=5)["corr"] < 0.4


def test_motion_energy_and_continuity():
    frames = np.zeros((4, 2, 2))
    frames[2] = 1.0
    assert maths.motion_energy(frames).tolist() == [0.0, 0.0, 1.0, 1.0]
    assert maths.consecutive_similarity(np.array([[1.0, 0.0], [1.0, 0.0], [0.0, 1.0]])) == pytest.approx(0.5)
    assert math.isnan(maths.consecutive_similarity(np.array([[1.0, 0.0]])))


def test_yunet_rows_come_back_in_the_pictures_pixels_with_the_eyes_left_to_right():
    # A face found on the picture at half size: box x, y, w, h, then right eye, left eye, nose, right and left mouth corners.
    row = [10, 20, 30, 40, 15, 30, 32, 30, 24, 40, 17, 50, 31, 50, 0.9]
    f = maths.yunet_face(row, scale=0.5)
    assert f["box"] == [20.0, 40.0, 80.0, 120.0]
    assert f["kps"].shape == (5, 2)
    # The subject's right eye is on the picture's left: ArcFace's template wants that one first.
    assert f["kps"][0][0] < f["kps"][1][0] and f["kps"][3][0] < f["kps"][4][0]
    assert f["kps"][2].tolist() == [48.0, 80.0]
    assert f["score"] == 0.9


def test_palette_fit_distance_and_cover():
    pal = maths.hex_colors(["#FF0000", "#00ff00", "0000FF", "nope"])
    assert pal.tolist() == [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
    # White is L*=100, a*=b*=0.
    assert maths.srgb_to_lab(np.array([255, 255, 255])) == pytest.approx([100.0, 0.0, 0.0], abs=0.01)
    # A picture in the palette's own colours: no distance, and it uses two of three.
    pic = np.array([[255, 0, 0]] * 50 + [[0, 0, 255]] * 50, dtype=np.uint8)
    on = maths.palette_fit(pic, pal)
    assert on["fit"] == pytest.approx(0.0, abs=1e-6)
    assert on["cover"] == pytest.approx(2 / 3)
    # Grey is far from all three; a near-red is close to red.
    grey = maths.palette_fit(np.full((10, 3), 128, dtype=np.uint8), pal)
    near = maths.palette_fit(np.full((10, 3), [250, 10, 5], dtype=np.uint8), pal)
    assert near["fit"] < 5 < grey["fit"]
    assert grey["cover"] == pytest.approx(1 / 3)
    assert math.isnan(maths.palette_fit(pic, maths.hex_colors([]))["fit"])


def test_palette_of_reads_the_request_or_the_lock_route():
    from fuobe_metrics.score import palette_of

    assert palette_of({"request": {"params": {"palette": ["#102030"]}}}).tolist() == [[16, 32, 48]]
    assert palette_of({"request": {"route": "/api/palettes/lock", "body": {"request": {"params": {}}, "colors": ["#FFFFFF"]}}}).tolist() == [[255, 255, 255]]
    assert len(palette_of({"request": {"prompt": "x"}})) == 0


def test_background_difference_on_the_outer_ring():
    src = np.full((3, 20, 20, 3), 100, dtype=np.uint8)
    out = src.copy()
    # The middle (the person) changes: the ring doesn't, so the background scores as untouched.
    out[:, 6:14, 6:14] = 255
    same = maths.background_difference(out, src)
    assert same["mae"] == pytest.approx(0.0)
    assert same["psnr"] == 99.0
    assert same["frames"] == 3
    # The whole frame brighter by 51 (0.2): the ring sees it.
    moved = maths.background_difference(np.clip(src.astype(int) + 51, 0, 255).astype(np.uint8), src)
    assert moved["mae"] == pytest.approx(0.2, abs=1e-6)
    assert moved["psnr"] == pytest.approx(10 * math.log10(1 / 0.04), abs=1e-3)
    assert maths.ring_mask(10, 10, 0.2).sum() == 100 - 36
    assert maths.background_difference(out[:0], src)["frames"] == 0
