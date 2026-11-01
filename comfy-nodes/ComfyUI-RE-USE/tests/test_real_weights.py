"""With the real weights. Skipped unless these are set (paths to local files):
    RE_USE_WEIGHTS    models/reuse/NemotronLabs-RE-USE.safetensors
    RE_USE_SAMPLE     noisy_audio/mic_test2.wav from NVIDIA's repository (5.1 s, 44.1 kHz)
    RE_USE_REFERENCE  the same sample through the reference runtime at its own rate, in one pass (a WAV)
    RE_USE_LONG       a longer recording (the chunking test uses its first 20 s at 8 kHz, so a CPU runs it in about 2 min)
"""
import math
import os

import pytest
import torch
import torchaudio

W = os.environ.get("RE_USE_WEIGHTS")
pytestmark = pytest.mark.skipif(not W or not os.path.isfile(W), reason="RE_USE_WEIGHTS isn't set")


def read(path):
    import soundfile as sf

    x, sr = sf.read(path, dtype="float32", always_2d=True)
    return torch.from_numpy(x.T.copy()), sr


def diff_snr(ref, y):
    n = min(ref.shape[-1], y.shape[-1])
    ref, y = ref[..., :n].double(), y[..., :n].double()
    return 10 * math.log10(float(ref.pow(2).sum()) / max(float((ref - y).pow(2).sum()), 1e-20))


@pytest.fixture(scope="module")
def model(engine):
    return engine.load_reuse(W, "cpu")


def test_the_node_matches_the_reference_runtime(nodes, model):
    sample, ref = os.environ.get("RE_USE_SAMPLE"), os.environ.get("RE_USE_REFERENCE")
    if not (sample and ref):
        pytest.skip("RE_USE_SAMPLE / RE_USE_REFERENCE aren't set")
    x, sr = read(sample)
    out, _ = nodes.REUSEEnhance().enhance({"model": model, "device": torch.device("cpu"), "name": "test"}, {"waveform": x.unsqueeze(0), "sample_rate": sr}, chunk_seconds=10.0, level="off")
    r, rsr = read(ref)
    assert out["sample_rate"] == rsr
    assert diff_snr(r[:1], out["waveform"][0][:1]) >= 40


def test_crossfade_chunks_are_as_close_to_one_pass_as_the_repos_hann_chunks(engine, model):
    """One pass over a long file is not the truth either: the network normalises over the whole input (InstanceNorm) and
    reads it both ways (bidirectional Mamba), so any chunking differs from it everywhere, not only at the joins. Measured
    on 20 s at 8 kHz: 5 s chunks 8.5 dB (crossfade) against 8.9 dB (the repo's Hann at 50%); 10 s chunks 14.8 against
    14.9 dB. The crossfade must stay within 1 dB of the repo's method, at about half its work."""
    long = os.environ.get("RE_USE_LONG")
    if not long:
        pytest.skip("RE_USE_LONG isn't set")
    x, sr = read(long)
    x = torchaudio.functional.resample(x.mean(0, keepdim=True), sr, 8000)[:, : 20 * 8000]
    seg = lambda s: engine.enhance_segment(model, s, 8000)  # noqa: E731
    whole = seg(x)
    cross = engine.enhance_chunked(seg, x, 8000, 10.0, 1.0)
    hann = engine.enhance_chunked(seg, x, 8000, 10.0, 1.0, window="hann")
    print(f"crossfade {diff_snr(whole, cross):.1f} dB, hann 50% {diff_snr(whole, hann):.1f} dB against one pass; crossfade against hann {diff_snr(hann, cross):.1f} dB")
    assert diff_snr(whole, cross) >= diff_snr(whole, hann) - 1.0
    assert diff_snr(hann, cross) >= 18
