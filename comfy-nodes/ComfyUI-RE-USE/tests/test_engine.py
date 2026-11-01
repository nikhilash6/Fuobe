"""The runtime without the real weights: the network's layout, the scans, chunking and levels."""
import hashlib
import math

import pytest
import torch

# The published model.safetensors (both NemotronLabs repositories): 1,416 tensors, these names and shapes.
STATE_DICT_SHA256 = "dd8f55c595948a376465faf60da9e4bac757d855d849697796c8a543fe1de57f"
PARAMETERS = 9_607_747


def test_state_dict_has_the_published_layout(engine):
    m = engine.REUSE()
    lines = sorted(f"{k}:{'x'.join(map(str, v.shape))}" for k, v in m.state_dict().items())
    assert len(lines) == 1416
    assert hashlib.sha256("\n".join(lines).encode()).hexdigest() == STATE_DICT_SHA256
    assert sum(p.numel() for p in m.parameters()) == PARAMETERS


def test_a_file_that_is_not_reuse_is_refused_in_words(engine, tmp_path):
    from safetensors.torch import save_file

    p = tmp_path / "other.safetensors"
    save_file({"weight": torch.zeros(2, 2)}, str(p))
    with pytest.raises(engine.NotReuseError, match="This file is not a RE-USE model"):
        engine.load_reuse(str(p))


def _scan_inputs(B=2, L=37, Di=64, N=16, seed=0):
    g = torch.Generator().manual_seed(seed)
    u = torch.randn(B, L, Di, generator=g)
    delta = torch.nn.functional.softplus(torch.randn(B, L, Di, generator=g))
    # Trained A values run from about -593 to -0.05.
    A = -torch.exp(torch.empty(Di, N).uniform_(math.log(0.05), math.log(600), generator=g))
    Bm = torch.randn(B, L, N, generator=g)
    Cm = torch.randn(B, L, N, generator=g)
    return u, delta, A, Bm, Cm


def _reference_scan(u, delta, A, Bm, Cm):
    # mamba_ssm's selective_scan_ref, written out: a float64 loop.
    u, delta, A, Bm, Cm = (t.double() for t in (u, delta, A, Bm, Cm))
    h = torch.zeros(u.shape[0], u.shape[2], A.shape[1], dtype=torch.float64)
    ys = []
    for t in range(u.shape[1]):
        h = torch.exp(delta[:, t, :, None] * A) * h + (delta[:, t] * u[:, t])[:, :, None] * Bm[:, t, None, :]
        ys.append((h * Cm[:, t, None, :]).sum(-1))
    return torch.stack(ys, 1).float()


def test_the_pytorch_loop_matches_the_reference(engine):
    args = _scan_inputs()
    torch.testing.assert_close(engine.scan_loop(*args), _reference_scan(*args), atol=2e-4, rtol=1e-4)


def test_the_numba_scan_matches_the_reference(engine):
    if not engine.numba_ok():
        pytest.skip("numba isn't installed here")
    args = _scan_inputs(seed=1)
    torch.testing.assert_close(engine.scan_numba(*args), _reference_scan(*args), atol=2e-4, rtol=1e-4)


def test_the_triton_scan_matches_the_reference(engine):
    if not torch.cuda.is_available() or torch.cuda.device_count() < 1 or not engine.triton_ok():
        pytest.skip("no CUDA with Triton here")
    args = _scan_inputs(seed=2)
    y = engine.scan(*(t.cuda() for t in args), mode="triton").cpu()
    torch.testing.assert_close(y, _reference_scan(*args), atol=2e-4, rtol=1e-4)


def test_auto_picks_a_scan_by_device(engine):
    assert engine.scan_kind("cpu") in ("numba", "torch-loop")
    assert engine.scan_kind("cpu", "torch-loop") == "torch-loop"


@pytest.mark.parametrize("n", [1, 999, 8000, 8001, 47_000, 160_000])
@pytest.mark.parametrize("chunk,overlap", [(1.0, 0.25), (2.0, 1.0), (5.0, 1.0), (0.5, 0.25)])
def test_crossfade_chunking_gives_back_an_identity_exactly(engine, n, chunk, overlap):
    x = torch.randn(2, n)
    calls = []

    def ident(seg):
        calls.append(seg.shape[1])
        return seg.clone()

    y = engine.enhance_chunked(ident, x, 8000, chunk, overlap)
    torch.testing.assert_close(y, x, atol=1e-6, rtol=0)
    assert all(c <= max(1, int(chunk * 8000)) for c in calls)


def test_crossfade_weights_add_up_to_one(engine):
    sr, chunk, ov = 1000, 3000, 500
    n = 10_400
    spans = engine.chunk_spans(n, chunk, ov)
    total = torch.zeros(n)
    for i, (s, e) in enumerate(spans):
        skip = max(0, spans[i - 1][1] - ov - s) if i > 0 else 0
        total[s:e] += engine.crossfade_weights(e - s, ov, skip, ramp_in=i > 0, ramp_out=i < len(spans) - 1)
    torch.testing.assert_close(total, torch.ones(n), atol=1e-6, rtol=0)
    assert spans[-1][1] == n and spans[0][0] == 0


def test_hann_chunking_gives_back_an_identity(engine):
    x = torch.randn(1, 50_000)
    torch.testing.assert_close(engine.enhance_chunked(lambda s: s.clone(), x, 8000, 2.0, 1.0, window="hann"), x, atol=1e-5, rtol=0)


def test_the_check_runs_before_every_chunk(engine):
    seen = []
    engine.enhance_chunked(lambda s: s.clone(), torch.randn(1, 40_000), 8000, 1.0, 0.25, check=lambda: seen.append(1))
    assert len(seen) == len(engine.chunk_spans(40_000, 8000, 2000))


def test_auto_chunk_length(engine):
    assert engine.auto_chunk_seconds(16000, "cpu") == 10.0
    assert engine.auto_chunk_seconds(44100, "cpu") == 5.0
    gb = 1024**3
    # 2 GB free at 16 kHz: (1.2 - 0.35) / 0.13 = 6.5 s; plenty free: 20 s; almost nothing: 2 s.
    assert engine.auto_chunk_seconds(16000, "cuda", 2 * gb) == pytest.approx(6.54, abs=0.01)
    assert engine.auto_chunk_seconds(16000, "cuda", 30 * gb) == 20.0
    assert engine.auto_chunk_seconds(48000, "cuda", int(0.5 * gb)) == 2.0


def test_loudness_fallback_agrees_with_torchaudio(engine):
    g = torch.Generator().manual_seed(3)
    sr = 24000
    t = torch.arange(sr * 3) / sr
    x = (0.2 * torch.sin(2 * math.pi * 440 * t) + 0.05 * torch.randn(sr * 3, generator=g)).unsqueeze(0)
    assert engine._lufs_fallback(x, sr) == pytest.approx(engine.lufs(x, sr), abs=0.3)


def test_peak_limit(engine):
    x = torch.tensor([[0.5, -1.4, 0.2]])
    y = engine.peak_limit(x)
    assert float(y.abs().max()) == pytest.approx(10 ** (-1 / 20))
    assert torch.equal(engine.peak_limit(x * 0.1), x * 0.1)


def test_a_triton_that_cannot_compile_falls_back_to_the_loop(engine, monkeypatch):
    def broken(*a):
        raise RuntimeError("Python.h: No such file or directory")

    monkeypatch.setattr(engine, "_TR", broken)
    monkeypatch.setattr(engine, "scan_kind", lambda device, mode="auto": "triton" if engine._TR else "torch-loop")
    args = _scan_inputs(seed=3)
    torch.testing.assert_close(engine.scan(*args), engine.scan_loop(*args))
    assert engine._TR is False
    assert engine.scan_kind("cuda") == "torch-loop"


def test_a_forced_triton_scan_still_raises(engine, monkeypatch):
    def broken(*a):
        raise RuntimeError("no compiler")

    monkeypatch.setattr(engine, "_TR", broken)
    monkeypatch.setattr(engine, "scan_kind", lambda device, mode="auto": "triton")
    with pytest.raises(RuntimeError, match="no compiler"):
        engine.scan(*_scan_inputs(), mode="triton")


def test_chunks_reach_the_model_one_at_a_time_and_the_result_stays_with_the_input(engine):
    # The node's segment moves a chunk to the model's device; the buffers stay with wav (the CPU).
    x = torch.randn(1, 40_000)
    seen = []

    def seg(s):
        seen.append(s.shape[1])
        return s.clone()

    y = engine.enhance_chunked(seg, x, 8000, 1.0, 0.25)
    assert y.device == x.device and max(seen) <= 8000


def test_a_clip_shorter_than_the_stft_padding_still_runs(engine):
    m = engine.REUSE().eval()
    for n in (1, 50, 400):
        y = engine.enhance_segment(m, torch.randn(1, n) * 0.1, 48000)
        assert y.shape == (1, n)
