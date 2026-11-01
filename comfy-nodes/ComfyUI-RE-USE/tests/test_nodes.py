"""The nodes with a stand-in model (no weights): rates, channels, levels, room tone, the bed and Cancel."""
import json
import math
import sys
import types

import pytest
import torch


def speech(sr, seconds=3.0, channels=1, level=0.3, seed=0):
    """Bursts of a harmonic tone with gaps, a little like speech (a level to match, pauses to fill)."""
    g = torch.Generator().manual_seed(seed)
    t = torch.arange(int(sr * seconds)) / sr
    gate = (torch.sin(2 * math.pi * 1.5 * t) > 0).float()
    x = level * gate * (torch.sin(2 * math.pi * 180 * t) + 0.4 * torch.sin(2 * math.pi * 360 * t)) + 0.01 * torch.randn(t.shape, generator=g)
    return x.repeat(channels, 1) * torch.linspace(1, 0.8, channels).unsqueeze(1)


def run(nodes, monkeypatch, segment, audio, **kw):
    monkeypatch.setattr(nodes.E, "enhance_segment", lambda model, x, sr: segment(x))
    model = {"model": object(), "device": torch.device("cpu"), "name": "stand-in"}
    out, report = nodes.REUSEEnhance().enhance(model, audio, **kw)
    return out, json.loads(report)


def audio_of(x, sr):
    return {"waveform": x.unsqueeze(0), "sample_rate": sr}


def test_the_node_lists_the_inputs_fuobe_binds(nodes):
    t = nodes.REUSEEnhance.INPUT_TYPES()
    for k in ("reuse_model", "audio", "rate", "pre_lowpass", "channels", "chunk_seconds", "overlap_seconds", "room_tone_db", "level"):
        assert k in t["required"]
    assert set(t["optional"]) == {"bed", "bed_db"}
    assert t["required"]["rate"][0] == ["source", "source up to 24000", "source up to 16000", "8000", "16000", "22050", "24000", "32000", "44100", "48000"]
    assert nodes.REUSEEnhance.RETURN_TYPES == ("AUDIO", "STRING")


def test_the_loader_registers_models_reuse(nodes, pack, models_dir):
    import folder_paths

    assert "reuse" in folder_paths.folder_names_and_paths
    assert nodes.REUSELoader.INPUT_TYPES()["required"]["model"][1]["default"] == "NemotronLabs-RE-USE.safetensors"
    with pytest.raises(FileNotFoundError, match="models/reuse"):
        nodes.REUSELoader().load("missing.safetensors", "cpu")


@pytest.mark.parametrize(
    "sr,rate,want",
    [(44100, "source", 44100), (44100, "source up to 24000", 24000), (16000, "source up to 24000", 16000), (48000, "source up to 16000", 16000), (44100, "16000", 16000), (8000, "48000", 48000), (6000, "source", 8000), (96000, "source", 48000), (96000, "16000", 16000), (6000, "48000", 48000)],
)
def test_rates(nodes, monkeypatch, sr, rate, want):
    x = speech(sr, 1.0)
    out, rep = run(nodes, monkeypatch, lambda s: s.clone(), audio_of(x, sr), rate=rate, level="off")
    assert out["sample_rate"] == want and rep["rate"] == want and rep["input_rate"] == sr
    # Exactly the input's length at the new rate (a sample of rounding at most).
    assert abs(out["waveform"].shape[-1] - round(x.shape[-1] * want / sr)) <= 1


def test_pre_lowpass_runs_down_then_up(nodes, monkeypatch):
    seen = []
    x = speech(48000, 1.0)
    out, _ = run(nodes, monkeypatch, lambda s: seen.append(s.shape[-1]) or s.clone(), audio_of(x, 48000), rate="48000", pre_lowpass="8000", level="off")
    assert out["sample_rate"] == 48000
    # The 8 kHz copy has no energy above 4 kHz: so neither has what the model got.
    spec = torch.fft.rfft(out["waveform"][0, 0])
    freqs = torch.fft.rfftfreq(out["waveform"].shape[-1], 1 / 48000)
    assert spec[freqs > 5000].abs().pow(2).sum() < 1e-3 * spec.abs().pow(2).sum()


@pytest.mark.parametrize("channels,src,want", [("mono", 2, 1), ("each channel", 2, 2), ("each channel", 1, 1), ("each channel", 6, 1), ("mono", 6, 1)])
def test_channels(nodes, monkeypatch, channels, src, want):
    out, rep = run(nodes, monkeypatch, lambda s: s.clone(), audio_of(speech(16000, 1.0, src), 16000), channels=channels, level="off")
    assert out["waveform"].shape[1] == want
    assert rep["channels"] == ("mono" if want == 1 and (channels == "mono" or src > 2) else channels)


def test_each_channel_runs_the_model_once_per_channel(nodes, monkeypatch):
    calls = []
    run(nodes, monkeypatch, lambda s: calls.append(1) or s.clone(), audio_of(speech(16000, 1.0, 2), 16000), channels="each channel", chunk_seconds=10.0, level="off")
    assert len(calls) == 2


def db(x):
    return 20 * math.log10(x)


def test_match_input_brings_back_the_speech_level(nodes, engine, monkeypatch):
    x = speech(24000, 3.0)
    # The model's output is quieter than its input (about 3 dB in practice): -6 dB here.
    out, rep = run(nodes, monkeypatch, lambda s: s * 0.5, audio_of(x, 24000), level="match input")
    y = out["waveform"][0]
    assert db(engine.frame_rms_p(y, 24000)) == pytest.approx(db(engine.frame_rms_p(x, 24000)), abs=0.5)
    assert rep["level_gain_db"] == pytest.approx(6.02, abs=0.1)
    assert float(y.abs().max()) <= 10 ** (-1 / 20) + 1e-6


def test_match_input_gains_at_most_12_db_and_never_clips(nodes, monkeypatch):
    out, rep = run(nodes, monkeypatch, lambda s: s * 0.01, audio_of(speech(16000, 2.0, level=0.9), 16000), level="match input")
    assert rep["level_gain_db"] == pytest.approx(12.0)
    out, _ = run(nodes, monkeypatch, lambda s: s * 3, audio_of(speech(16000, 2.0, level=0.9), 16000), level="off")
    assert float(out["waveform"].abs().max()) <= 10 ** (-1 / 20) + 1e-6


def test_voice_over_level(nodes, engine, monkeypatch):
    out, _ = run(nodes, monkeypatch, lambda s: s.clone(), audio_of(speech(24000, 4.0, level=0.05), 24000), level="-16 LUFS")
    assert engine.lufs(out["waveform"][0], 24000) == pytest.approx(-16, abs=1.0)


def test_room_tone_adds_the_dry_signal_at_its_level(nodes, monkeypatch):
    x = speech(16000, 1.0)
    out, _ = run(nodes, monkeypatch, lambda s: torch.zeros_like(s), audio_of(x, 16000), room_tone_db=-24.0, level="off")
    torch.testing.assert_close(out["waveform"][0], x * 10 ** (-24 / 20), atol=1e-6, rtol=0)
    out, _ = run(nodes, monkeypatch, lambda s: torch.zeros_like(s), audio_of(x, 16000), room_tone_db=-60.0, level="off")
    assert float(out["waveform"].abs().max()) == 0


def test_bed_is_matched_in_rate_and_channels_and_kept_under_full_scale(nodes, monkeypatch):
    voice = speech(16000, 2.0, level=0.6)
    bed = speech(48000, 2.0, channels=2, level=0.6, seed=4) * 1.2
    out, rep = run(nodes, monkeypatch, lambda s: s.clone(), audio_of(voice, 16000), level="off", bed={"waveform": bed.unsqueeze(0), "sample_rate": 48000}, bed_db=0.0)
    assert out["sample_rate"] == 48000 and rep["output_rate"] == 48000 and rep["rate"] == 16000
    assert out["waveform"].shape[1] == 2
    assert abs(out["waveform"].shape[-1] - bed.shape[-1]) <= 1
    assert float(out["waveform"].abs().max()) <= 10 ** (-1 / 20) + 1e-6


def test_bed_at_a_lower_rate_takes_the_voice_rate(nodes, monkeypatch):
    bed = speech(16000, 1.0, channels=1, level=0.1, seed=5)
    out, _ = run(nodes, monkeypatch, lambda s: s.clone(), audio_of(speech(24000, 1.0, level=0.1), 24000), level="off", bed={"waveform": bed.unsqueeze(0), "sample_rate": 16000}, bed_db=-6.0)
    assert out["sample_rate"] == 24000 and out["waveform"].shape[1] == 1


def test_cancel_is_checked_between_chunks(nodes, monkeypatch):
    calls = {"n": 0}

    def check():
        calls["n"] += 1
        if calls["n"] == 2:
            raise InterruptedError("cancelled")

    comfy = types.ModuleType("comfy")
    mm = types.ModuleType("comfy.model_management")
    mm.throw_exception_if_processing_interrupted = check
    comfy.model_management = mm
    monkeypatch.setitem(sys.modules, "comfy", comfy)
    monkeypatch.setitem(sys.modules, "comfy.model_management", mm)
    seen = []
    with pytest.raises(InterruptedError):
        run(nodes, monkeypatch, lambda s: seen.append(1) or s.clone(), audio_of(speech(8000, 5.0), 8000), chunk_seconds=1.0, level="off")
    assert len(seen) == 1


def test_the_report_has_every_field(nodes, monkeypatch):
    _, rep = run(nodes, monkeypatch, lambda s: s.clone(), audio_of(speech(16000, 1.0), 16000))
    for k in ("model", "device", "scan", "input_rate", "rate", "output_rate", "channels", "chunk_seconds", "overlap_seconds", "seconds", "took", "times_real_time", "level_gain_db", "peak_vram_gb"):
        assert k in rep
    assert rep["device"] == "cpu" and rep["chunk_seconds"] == 10.0


def test_a_batch_keeps_each_item(nodes, monkeypatch):
    x = torch.stack([speech(16000, 1.0), speech(16000, 1.0, seed=9)])
    out, _ = run(nodes, monkeypatch, lambda s: s.clone(), {"waveform": x, "sample_rate": 16000}, level="off")
    assert out["waveform"].shape == (2, 1, 16000)
    torch.testing.assert_close(out["waveform"], x, atol=1e-6, rtol=0)
