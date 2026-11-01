"""ComfyUI nodes for NVIDIA NemotronLabs RE-USE (universal speech enhancement). Fuobe's own pack, MIT.

REUSELoader  -> models/reuse/<file>.safetensors (RE-USE, or RE-USE-laughter), on auto / cuda / cpu.
REUSEEnhance -> AUDIO in, AUDIO out, and a JSON report. It removes noise, echo, clipping, codec damage and the
                limits of a poor mic or a phone line, and keeps the main speaker. Run above the source's rate, it fills
                the empty high band (bandwidth extension). Long files run a chunk at a time with crossfaded joins.

No mamba_ssm or causal_conv1d: the Mamba layers run in plain PyTorch (reuse_engine.py), with a Triton scan on CUDA or a
numba scan on the CPU when those are importable, else a PyTorch loop. No package beyond what ComfyUI has.
"""
import json
import os
import time

import torch
import torchaudio

import folder_paths

from . import reuse_engine as E

FOLDER = "reuse"
DEFAULT_FILE = "NemotronLabs-RE-USE.safetensors"

# models/reuse, listed by GET /models/reuse (Fuobe's presence check reads it).
_dir = os.path.join(folder_paths.models_dir, FOLDER)
if FOLDER not in folder_paths.folder_names_and_paths:
    folder_paths.folder_names_and_paths[FOLDER] = ([_dir], {".safetensors"})

# "source up to N": the source's rate, or N when the source is higher (a CPU's pick when the source rate is unknown).
RATES = ["source", "source up to 24000", "source up to 16000", "8000", "16000", "22050", "24000", "32000", "44100", "48000"]
LOWPASS = ["off", "8000", "16000", "22050", "24000"]
LEVELS = ["match input", "-16 LUFS", "off"]
ROOM_TONE_OFF = -60.0
MATCH_MAX_GAIN_DB = 12.0


def _device(choice):
    if choice == "cpu" or not torch.cuda.is_available():
        return torch.device("cpu")
    if choice == "cuda":
        return torch.device("cuda")
    try:
        import comfy.model_management as mm

        return mm.get_torch_device()
    except Exception:
        return torch.device("cuda")


def _interrupt_check():
    """ComfyUI's Cancel, checked between chunks (nothing outside ComfyUI)."""
    try:
        import comfy.model_management as mm
    except ImportError:
        return None
    return mm.throw_exception_if_processing_interrupted


def _progress_bar(total):
    try:
        from comfy.utils import ProgressBar

        return ProgressBar(total)
    except Exception:
        return None


def _resample(x, src, dst):
    if src == dst:
        return x
    return torchaudio.functional.resample(x, src, dst, resampling_method="sinc_interp_kaiser")


def work_rate(rate, source_rate):
    """The rate the model runs at: the source's (8-48 kHz) or the one asked for, inside 8-48 kHz."""
    if rate == "source":
        want = source_rate
    elif rate.startswith("source up to "):
        want = min(source_rate, int(rate.rsplit(" ", 1)[1]))
    else:
        want = int(rate)
    return int(min(E.MAX_RATE, max(E.MIN_RATE, want)))


def prepare(x, sr, rate, pre_lowpass="off"):
    """x (C, N) at sr -> (x at the work rate, the work rate). The model's range is 8-48 kHz; an optional pre-low-pass
    resamples down first (NVIDIA's demo does this before bandwidth extension)."""
    cur = int(min(E.MAX_RATE, max(E.MIN_RATE, sr)))
    x = _resample(x, sr, cur)
    if pre_lowpass != "off" and int(pre_lowpass) < cur:
        x = _resample(x, cur, int(pre_lowpass))
        cur = int(pre_lowpass)
    target = work_rate(rate, int(min(E.MAX_RATE, max(E.MIN_RATE, sr))))
    return _resample(x, cur, target), target


def match_level(y, ref, sr):
    """Gain that brings y's speech level (95th percentile of 30 ms frame RMS) to ref's, at most +12 dB. Returns (y, dB)."""
    a, b = E.frame_rms_p(ref, sr), E.frame_rms_p(y, sr)
    if a <= 1e-6 or b <= 1e-6:
        return y, 0.0
    import math

    db = min(MATCH_MAX_GAIN_DB, 20 * math.log10(a / b))
    return y * 10 ** (db / 20), db


def to_lufs(y, sr, target=-16.0):
    import math

    cur = E.lufs(y, sr)
    if not math.isfinite(cur) or cur <= -70:
        return y, 0.0
    db = min(MATCH_MAX_GAIN_DB * 2, target - cur)
    return y * 10 ** (db / 20), db


def mix_bed(voice, v_sr, bed, b_sr, bed_db):
    """The clean voice (C, N) over a bed (Cb, M): at the higher of the two rates, mono voice on every bed channel, the
    bed at bed_db, and the sum scaled down to -1 dBFS if it peaks over. Returns (mix, rate)."""
    sr = max(v_sr, b_sr)
    voice, bed = _resample(voice, v_sr, sr), _resample(bed, b_sr, sr)
    ch = max(voice.shape[0], bed.shape[0])
    if voice.shape[0] != ch:
        voice = voice.mean(0, keepdim=True).expand(ch, -1)
    if bed.shape[0] != ch:
        bed = bed.mean(0, keepdim=True).expand(ch, -1)
    n = max(voice.shape[1], bed.shape[1])
    out = torch.zeros(ch, n)
    out[:, : voice.shape[1]] += voice
    out[:, : bed.shape[1]] += bed * 10 ** (bed_db / 20)
    return E.peak_limit(out), sr


class REUSELoader:
    @classmethod
    def INPUT_TYPES(cls):
        files = folder_paths.get_filename_list(FOLDER)
        return {
            "required": {
                "model": (files or [DEFAULT_FILE], {"default": DEFAULT_FILE if DEFAULT_FILE in files or not files else files[0], "tooltip": "A RE-USE model in models/reuse"}),
                "device": (["auto", "cuda", "cpu"], {"default": "auto"}),
            }
        }

    RETURN_TYPES = ("REUSE_MODEL",)
    FUNCTION = "load"
    CATEGORY = "audio/RE-USE"
    DESCRIPTION = "Loads NVIDIA RE-USE (speech enhancement, 9.6M parameters) from models/reuse."

    def load(self, model, device):
        get = getattr(folder_paths, "get_full_path_or_raise", None) or folder_paths.get_full_path
        path = get(FOLDER, model)
        if not path:
            raise FileNotFoundError(f"RE-USE isn't in models/reuse yet ({model})")
        dev = _device(device)
        return ({"model": E.load_reuse(path, dev), "device": dev, "name": model},)


class REUSEEnhance:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "reuse_model": ("REUSE_MODEL",),
                "audio": ("AUDIO",),
                "rate": (RATES, {"default": "source", "tooltip": "The rate the model runs at. Lower is faster and band-limited; higher than the source fills the empty high band (bandwidth extension)."}),
                "pre_lowpass": (LOWPASS, {"default": "off", "tooltip": "Resample down to this rate first (before bandwidth extension)"}),
                "channels": (["mono", "each channel"], {"default": "mono", "tooltip": "Mono is the mean of the channels; more than 2 channels always run in mono"}),
                "chunk_seconds": ("FLOAT", {"default": 0.0, "min": 0.0, "max": 30.0, "step": 0.5, "tooltip": "0 = from the free memory"}),
                "overlap_seconds": ("FLOAT", {"default": 1.0, "min": 0.25, "max": 5.0, "step": 0.25}),
                "room_tone_db": ("FLOAT", {"default": ROOM_TONE_OFF, "min": -60.0, "max": -6.0, "step": 1.0, "tooltip": "Mix the original in under the clean voice at this level (-60 = off): no dead silence between words"}),
                "level": (LEVELS, {"default": "match input"}),
            },
            "optional": {
                "bed": ("AUDIO", {"tooltip": "Music and effects to mix back under the clean voice"}),
                "bed_db": ("FLOAT", {"default": 0.0, "min": -30.0, "max": 6.0, "step": 0.5}),
            },
        }

    RETURN_TYPES = ("AUDIO", "STRING")
    RETURN_NAMES = ("audio", "report")
    FUNCTION = "enhance"
    CATEGORY = "audio/RE-USE"
    DESCRIPTION = "Clean up voice: removes noise, echo, clipping and codec damage from speech and keeps the main speaker."

    def enhance(self, reuse_model, audio, rate="source", pre_lowpass="off", channels="mono", chunk_seconds=0.0, overlap_seconds=1.0, room_tone_db=ROOM_TONE_OFF, level="match input", bed=None, bed_db=0.0):
        model, dev = reuse_model["model"], reuse_model["device"]
        wav = audio["waveform"]  # (B, C, N)
        sr_in = int(audio["sample_rate"])
        mono = channels == "mono" or wav.shape[1] > 2
        work = work_rate(rate, sr_in)
        chunk = float(chunk_seconds) if chunk_seconds and chunk_seconds > 0 else E.auto_chunk_seconds(work, dev)
        check = _interrupt_check()
        t0 = time.time()
        if dev.type == "cuda":
            torch.cuda.reset_peak_memory_stats(dev)

        def segment(x):
            return E.enhance_segment(model, x.to(dev), work).float()

        outs, gains = [], []
        n_items = wav.shape[0]
        pbar = _progress_bar(1000)
        for b in range(n_items):
            x = wav[b].float()
            if mono and x.shape[0] > 1:
                x = x.mean(0, keepdim=True)
            dry, sr = prepare(x, sr_in, rate, pre_lowpass)
            prog = (lambda d, t, b=b: pbar.update_absolute(int(1000 * (b + d / t) / n_items))) if pbar else None
            # dry stays on the CPU: enhance_chunked moves one chunk at a time to the device.
            y = E.enhance_chunked(segment, dry, sr, chunk, overlap_seconds, progress=prog, check=check)
            if room_tone_db > ROOM_TONE_OFF:
                y = y + dry * 10 ** (room_tone_db / 20)
            gain = 0.0
            if level == "match input":
                y, gain = match_level(y, dry, sr)
            elif level == "-16 LUFS":
                y, gain = to_lufs(y, sr)
            y = E.peak_limit(y)
            if bed is not None:
                bw = bed["waveform"][min(b, bed["waveform"].shape[0] - 1)].float()
                y, sr = mix_bed(y, sr, bw, int(bed["sample_rate"]), bed_db)
            outs.append(y)
            gains.append(gain)
        out_sr = sr
        n = max(o.shape[-1] for o in outs)
        ch = max(o.shape[0] for o in outs)
        out = torch.zeros(len(outs), ch, n)
        for i, o in enumerate(outs):
            out[i, : o.shape[0], : o.shape[-1]] = o
        seconds = wav.shape[-1] / sr_in
        took = time.time() - t0
        report = {
            "model": reuse_model["name"],
            "device": str(dev),
            "scan": E.scan_kind(dev),
            "input_rate": sr_in,
            "rate": work,
            "output_rate": out_sr,
            "channels": "mono" if mono else "each channel",
            "chunk_seconds": round(chunk, 2),
            "overlap_seconds": overlap_seconds,
            "seconds": round(seconds, 2),
            "took": round(took, 2),
            "times_real_time": round(seconds / took, 2) if took > 0 else None,
            "level_gain_db": round(gains[0], 2) if gains else 0.0,
            "peak_vram_gb": round(torch.cuda.max_memory_allocated(dev) / 1024**3, 2) if dev.type == "cuda" else None,
        }
        return ({"waveform": out, "sample_rate": out_sr}, json.dumps(report))


NODE_CLASS_MAPPINGS = {"REUSELoader": REUSELoader, "REUSEEnhance": REUSEEnhance}
NODE_DISPLAY_NAME_MAPPINGS = {"REUSELoader": "Load RE-USE (speech enhancement)", "REUSEEnhance": "Clean up voice (RE-USE)"}
