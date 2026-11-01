# ComfyUI-RE-USE: a plain-PyTorch runtime for NVIDIA NemotronLabs RE-USE (universal speech enhancement).
#
# The network classes below (REUSE, the dense encoder and decoders, the time-frequency Mamba blocks) and the STFT
# settings are adapted from NVIDIA's RE-USE repository:
#   SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#   SPDX-License-Identifier: OpenMDW-1.1
# (see LICENSE.OpenMDW-1.1-NVIDIA and NOTICE). The Mamba layer is re-written here without the mamba_ssm and
# causal_conv1d CUDA extensions, with the same parameter names, so the published model.safetensors loads unchanged
# (strict=True). The scans, the chunking and everything else in this file are Fuobe's own code (MIT, see LICENSE).
import math

import torch
import torch.nn as nn
import torch.nn.functional as F

# ---------------------------------------------------------------- selective scan


class PureMamba(nn.Module):
    """Mamba v1 block with the state_dict layout of mamba_ssm.Mamba (in_proj, conv1d, x_proj, dt_proj, A_log, D, out_proj)."""

    # "auto" picks triton on CUDA, numba on the CPU, and the PyTorch loop when neither is importable.
    scan_mode = "auto"

    def __init__(self, d_model, d_state=16, d_conv=4, expand=2):
        super().__init__()
        self.d_model, self.d_state, self.d_conv = d_model, d_state, d_conv
        self.d_inner = int(expand * d_model)
        self.dt_rank = math.ceil(d_model / 16)
        self.in_proj = nn.Linear(d_model, self.d_inner * 2, bias=False)
        self.conv1d = nn.Conv1d(self.d_inner, self.d_inner, d_conv, groups=self.d_inner, padding=d_conv - 1, bias=True)
        self.x_proj = nn.Linear(self.d_inner, self.dt_rank + 2 * d_state, bias=False)
        self.dt_proj = nn.Linear(self.dt_rank, self.d_inner, bias=True)
        self.A_log = nn.Parameter(torch.zeros(self.d_inner, d_state))
        self.D = nn.Parameter(torch.ones(self.d_inner))
        self.out_proj = nn.Linear(self.d_inner, d_model, bias=False)

    def forward(self, h):  # h: (B, L, d_model)
        L = h.shape[1]
        x, z = self.in_proj(h).chunk(2, dim=-1)
        x = F.silu(self.conv1d(x.transpose(1, 2))[..., :L]).transpose(1, 2)  # (B, L, Di)
        dt, Bm, Cm = torch.split(self.x_proj(x), [self.dt_rank, self.d_state, self.d_state], dim=-1)
        delta = F.softplus(self.dt_proj(dt))  # dt_proj's bias is mamba_ssm's delta_bias
        A = -torch.exp(self.A_log.float())  # (Di, N)
        y = scan(x.float(), delta.float(), A, Bm.float(), Cm.float(), self.scan_mode)
        y = y + x * self.D
        y = y * F.silu(z)
        return self.out_proj(y)


def scan_kind(device, mode="auto"):
    """The scan back end a device runs: "triton" (CUDA), "numba" (CPU) or "torch-loop"."""
    if mode != "auto":
        return mode
    if torch.device(device).type == "cuda":
        return "triton" if triton_ok() else "torch-loop"
    return "numba" if numba_ok() else "torch-loop"


def scan(u, delta, A, Bm, Cm, mode="auto"):
    """h_t = exp(delta_t * A) * h_{t-1} + delta_t * u_t * B_t;  y_t = <h_t, C_t>.
    u, delta: (B, L, Di); Bm, Cm: (B, L, N); A: (Di, N)  ->  y: (B, L, Di)."""
    kind = scan_kind(u.device, mode)
    if kind == "triton":
        try:
            return _TR(u, delta, A, Bm, Cm)
        except Exception as e:  # imports but can't compile here (no Python.h, a Triton that doesn't fit torch or the GPU)
            if mode != "auto":
                raise
            _triton_failed(e)
            return scan_loop(u, delta, A, Bm, Cm)
    if kind == "numba":
        return scan_numba(u, delta, A, Bm, Cm)
    return scan_loop(u, delta, A, Bm, Cm)


def scan_loop(u, delta, A, Bm, Cm):
    """The reference: a PyTorch loop over time. Works everywhere."""
    Bsz, L, Di = u.shape
    h = u.new_zeros(Bsz, Di, A.shape[1])
    ys = u.new_empty(Bsz, L, Di)
    du = delta * u
    for t in range(L):
        dA = torch.exp(delta[:, t, :, None] * A)  # (B, Di, N)
        h = torch.addcmul(du[:, t, :, None] * Bm[:, t, None, :], dA, h)
        ys[:, t] = torch.einsum("bdn,bn->bd", h, Cm[:, t])
    return ys


# ---- fused CPU scan: numba comes with librosa, which most ComfyUI installs have. Optional.
_NB = None


def numba_ok():
    global _NB
    if _NB is None:
        try:
            _NB = _build_numba()
        except Exception:
            _NB = False
    return _NB is not False


def _build_numba():
    import math as _m

    import numpy as np
    from numba import njit, prange

    @njit(parallel=True, fastmath=True, cache=False)
    def kern(u, dl, A, Bm, Cm, y):
        Bsz, L, Di = u.shape
        N = A.shape[1]
        for idx in prange(Bsz * Di):
            b = idx // Di
            d = idx - b * Di
            h = np.zeros(N, np.float32)
            a = A[d]
            for t in range(L):
                dt = dl[b, t, d]
                du = dt * u[b, t, d]
                acc = np.float32(0.0)
                for n in range(N):
                    hn = _m.exp(dt * a[n]) * h[n] + du * Bm[b, t, n]
                    h[n] = hn
                    acc += hn * Cm[b, t, n]
                y[b, t, d] = acc

    return kern


def scan_numba(u, delta, A, Bm, Cm):
    import numpy as np

    if not numba_ok():
        raise RuntimeError("numba is not available")
    un = u.detach().cpu().contiguous().numpy()
    y = np.empty_like(un)
    _NB(un, delta.detach().cpu().contiguous().numpy(), A.detach().cpu().contiguous().numpy(), Bm.detach().cpu().contiguous().numpy(), Cm.detach().cpu().contiguous().numpy(), y)
    return torch.from_numpy(y).to(u.device)


# ---- fused GPU scan: triton (triton-windows on Windows), which most CUDA ComfyUI installs have. Optional.
_TR = None


def _triton_failed(e):
    """Triton's first launch failed: use the PyTorch loop from now on (scan_kind then says "torch-loop")."""
    global _TR
    _TR = False
    print(f"[RE-USE] the Triton scan can't run here ({type(e).__name__}: {str(e).splitlines()[0][:200] if str(e) else ''}); using the PyTorch scan")


def triton_ok():
    global _TR
    if _TR is None:
        try:
            _TR = _build_triton()
        except Exception:
            _TR = False
    return _TR is not False


def _build_triton():
    import triton
    import triton.language as tl

    @triton.jit
    def kern(u_ptr, dt_ptr, A_ptr, B_ptr, C_ptr, y_ptr, L, Di, N: tl.constexpr, BLOCK_D: tl.constexpr):
        pid_b = tl.program_id(0)
        pid_d = tl.program_id(1)
        d = pid_d * BLOCK_D + tl.arange(0, BLOCK_D)
        n = tl.arange(0, N)
        md = d < Di
        A = tl.load(A_ptr + d[:, None] * N + n[None, :], mask=md[:, None], other=0.0)
        h = tl.zeros((BLOCK_D, N), dtype=tl.float32)
        bud = pid_b.to(tl.int64) * L * Di
        bn = pid_b.to(tl.int64) * L * N
        for t in range(L):
            uu = tl.load(u_ptr + bud + t * Di + d, mask=md, other=0.0)
            dl = tl.load(dt_ptr + bud + t * Di + d, mask=md, other=0.0)
            Bv = tl.load(B_ptr + bn + t * N + n)
            Cv = tl.load(C_ptr + bn + t * N + n)
            h = tl.exp(dl[:, None] * A) * h + (dl * uu)[:, None] * Bv[None, :]
            tl.store(y_ptr + bud + t * Di + d, tl.sum(h * Cv[None, :], axis=1), mask=md)

    def run(u, delta, A, Bm, Cm):
        Bsz, L, Di = u.shape
        N = A.shape[1]
        u, delta, A, Bm, Cm = (t.contiguous() for t in (u, delta, A, Bm, Cm))
        y = torch.empty_like(u)
        BLOCK_D = 64
        kern[(Bsz, triton.cdiv(Di, BLOCK_D))](u, delta, A, Bm, Cm, y, L, Di, N=N, BLOCK_D=BLOCK_D)
        return y

    return run


# ---------------------------------------------------------------- the RE-USE network (SEMamba, time_d4)
# Adapted from NVIDIA's RE-USE repository (OpenMDW-1.1): models/generator_SEMamba_time_d4.py,
# models/codec_module_time_d4.py and models/mamba_block2_SEMamba.py.


def _pad2d(k, d=(1, 1)):
    return (int((k[0] * d[0] - d[0]) / 2), int((k[1] * d[1] - d[1]) / 2))


class SPConvTranspose2d(nn.Module):
    def __init__(self, cin, cout, k, r=1):
        super().__init__()
        self.pad1 = nn.ConstantPad2d((1, 1, 0, 0), 0.0)
        self.conv = nn.Conv2d(cin, cout * r, kernel_size=k, stride=(1, 1))
        self.r = r

    def forward(self, x):
        out = self.conv(self.pad1(x))
        b, c, H, W = out.shape
        out = out.view(b, self.r, c // self.r, H, W).permute(0, 2, 3, 4, 1)
        return out.contiguous().view(b, c // self.r, H, -1)


class DenseBlock(nn.Module):
    def __init__(self, h, k=(3, 3), depth=4):
        super().__init__()
        self.depth = depth
        self.dense_block = nn.ModuleList()
        for i in range(depth):
            dil = 2**i
            self.dense_block.append(nn.Sequential(nn.Conv2d(h * (i + 1), h, k, dilation=(dil, 1), padding=_pad2d(k, (dil, 1))), nn.InstanceNorm2d(h, affine=True), nn.PReLU(h)))

    def forward(self, x):
        skip = x
        for i in range(self.depth):
            x = self.dense_block[i](skip)
            skip = torch.cat([x, skip], 1)
        return x


class DenseEncoder(nn.Module):
    def __init__(self, h, cin=2):
        super().__init__()
        self.dense_conv_1 = nn.Sequential(nn.Conv2d(cin, h, (1, 1)), nn.InstanceNorm2d(h, affine=True), nn.PReLU(h))
        self.dense_block = DenseBlock(h, depth=4)
        self.dense_conv_2 = nn.Sequential(nn.Conv2d(h, h, (1, 3), stride=(4, 2)), nn.InstanceNorm2d(h, affine=True), nn.PReLU(h))

    def forward(self, x):
        return self.dense_conv_2(self.dense_block(self.dense_conv_1(x)))


class _Dec(nn.Module):
    def __init__(self, h):
        super().__init__()
        self.dense_block = DenseBlock(h, depth=4)
        self.up_conv1 = nn.Sequential(SPConvTranspose2d(h, h, (1, 3), 2), nn.InstanceNorm2d(h, affine=True), nn.PReLU(h))
        self.up_conv2 = nn.Sequential(SPConvTranspose2d(h, h, (1, 3), 4), nn.InstanceNorm2d(h, affine=True), nn.PReLU(h))

    def trunk(self, x):
        x = self.up_conv1(self.dense_block(x))
        return self.up_conv2(x.permute(0, 1, 3, 2)).permute(0, 1, 3, 2)


class MagDecoder(_Dec):
    def __init__(self, h, cout=1):
        super().__init__(h)
        self.final_conv = nn.Conv2d(h, cout, (1, 1))

    def forward(self, x):
        return self.final_conv(self.trunk(x))


class PhaseDecoder(_Dec):
    def __init__(self, h, cout=1):
        super().__init__(h)
        self.phase_conv_r = nn.Conv2d(h, cout, (1, 1))
        self.phase_conv_i = nn.Conv2d(h, cout, (1, 1))

    def forward(self, x):
        x = self.trunk(x)
        return torch.atan2(self.phase_conv_i(x), self.phase_conv_r(x))


class BiMamba(nn.Module):
    def __init__(self, d, d_state, d_conv, expand):
        super().__init__()
        self.forward_blocks = PureMamba(d, d_state, d_conv, expand)
        self.backward_blocks = PureMamba(d, d_state, d_conv, expand)
        self.output_proj = nn.Linear(2 * d, d)
        self.norm = nn.LayerNorm(d)

    def forward(self, x):
        fw = self.forward_blocks(x) + x
        xr = torch.flip(x, dims=[1])
        bw = torch.flip(self.backward_blocks(xr) + xr, dims=[1])
        return self.norm(self.output_proj(torch.cat([fw, bw], -1)))


class TFMambaBlock(nn.Module):
    def __init__(self, h, d_state, d_conv, expand):
        super().__init__()
        self.time_mamba = BiMamba(h, d_state, d_conv, expand)
        self.freq_mamba = BiMamba(h, d_state, d_conv, expand)

    def forward(self, x):
        b, c, t, f = x.size()
        x = x.permute(0, 3, 2, 1).contiguous().view(b * f, t, c)
        x = self.time_mamba(x) + x
        x = x.view(b, f, t, c).permute(0, 2, 1, 3).contiguous().view(b * t, f, c)
        x = self.freq_mamba(x) + x
        return x.view(b, t, f, c).permute(0, 3, 1, 2)


class REUSE(nn.Module):
    def __init__(self, hid=64, n_blocks=30, d_state=16, d_conv=4, expand=4):
        super().__init__()
        self.dense_encoder = DenseEncoder(hid)
        self.TSMamba = nn.ModuleList([TFMambaBlock(hid, d_state, d_conv, expand) for _ in range(n_blocks)])
        self.mask_decoder = MagDecoder(hid)
        self.phase_decoder = PhaseDecoder(hid)

    def forward(self, mag, pha):  # (B, F, T)
        x = torch.stack((mag.transpose(1, 2), pha.transpose(1, 2)), 1)  # (B, 2, T, F)
        T, Fq = x.shape[2], x.shape[3]
        x = self.dense_encoder(F.pad(x, (0, 2, 0, 2)))
        for blk in self.TSMamba:
            x = blk(x)
        m = self.mask_decoder(x).squeeze(1).transpose(1, 2)[:, :Fq, :T]
        p = self.phase_decoder(x).squeeze(1).transpose(1, 2)[:, :Fq, :T]
        return m, p


class NotReuseError(ValueError):
    pass


def load_reuse(path, device="cpu"):
    """The published model.safetensors (RE-USE or RE-USE-laughter), loaded with strict=True."""
    from safetensors.torch import load_file

    model = REUSE()
    try:
        model.load_state_dict(load_file(path), strict=True)
    except Exception as e:  # a different network, or not a safetensors file
        raise NotReuseError("This file is not a RE-USE model") from e
    return model.to(device).eval()


# ---------------------------------------------------------------- STFT and one segment (as the repo's inference.py)
# The STFT is scaled to the rate: n_fft 320, hop 40, window 320 at 8 kHz (a 40 ms window and a 5 ms hop at any rate).

BASE_SR, BASE_NFFT, BASE_HOP, BASE_WIN = 8000, 320, 40, 320
MIN_RATE, MAX_RATE = 8000, 48000


def _even(v):
    v = int(round(v))
    return v if v % 2 == 0 else v + 1


def stft_params(sr):
    return _even(BASE_NFFT * sr // BASE_SR), _even(BASE_HOP * sr // BASE_SR), _even(BASE_WIN * sr // BASE_SR)


@torch.no_grad()
def enhance_segment(model, wav, sr):
    """wav: (1, N) on the model's device -> (1, N)."""
    n_fft, hop, win = stft_params(sr)
    n = wav.shape[1]
    if n <= n_fft // 2:  # shorter than the reflect padding allows (about 20 ms): zero-pad, run, trim
        wav = F.pad(wav, (0, n_fft - n))
    window = torch.hann_window(win, device=wav.device)
    spec = torch.stft(wav, n_fft, hop_length=hop, win_length=win, window=window, center=True, pad_mode="reflect", normalized=False, return_complex=True)
    amp_g, pha_g = model(torch.log1p(spec.abs()), spec.angle())
    lin = torch.expm1(F.relu(amp_g))
    # The repo's guard against a "strange sweep artifact": frames where more than half the bins are zero become zero.
    zero_portion = (lin == 0).sum(1) / lin.shape[1]
    amp_g[:, :, (zero_portion > 0.5)[0]] = 0
    lin = torch.expm1(F.relu(amp_g))
    out = torch.istft(torch.polar(lin, pha_g), n_fft, hop_length=hop, win_length=win, window=window, center=True)
    if out.shape[1] >= n:
        return out[:, :n]
    return F.pad(out, (0, n - out.shape[1]))


# ---------------------------------------------------------------- chunking


def chunk_spans(n, chunk, overlap):
    """Start and end of every chunk over n samples: chunks of `chunk` samples, `overlap` apart at each join; the last
    chunk ends at n (so it may overlap its neighbour by more)."""
    if n <= chunk:
        return [(0, n)]
    hop = max(1, chunk - overlap)
    spans = []
    s = 0
    while s + chunk < n:
        spans.append((s, s + chunk))
        s += hop
    spans.append((n - chunk, n))
    return spans


def crossfade_weights(length, ramp, skip=0, ramp_in=True, ramp_out=True, device=None):
    """A chunk's weights: 0 for its first `skip` samples (covered by the chunk before), then a raised-cosine ramp in over
    `ramp` samples, 1, and a ramp out over its last `ramp` samples. A ramp out and the next chunk's ramp in fall on the
    same samples and add up to 1."""
    w = torch.ones(length, device=device)
    if ramp > 0:
        t = (torch.arange(ramp, device=device, dtype=torch.float32) + 0.5) / ramp
        if ramp_in:
            w[:skip] = 0
            w[skip : skip + ramp] = 0.5 * (1 - torch.cos(math.pi * t))
        if ramp_out:
            w[length - ramp :] = w[length - ramp :] * 0.5 * (1 + torch.cos(math.pi * t))
    return w


def auto_chunk_seconds(rate, device, free_bytes=None):
    """Chunk length from the memory model: about (0.35 + 0.13 x rate/16 kHz x seconds) GB on CUDA, 60% of what is free;
    10 s on a CPU below 32 kHz, else 5 s."""
    if torch.device(device).type != "cuda":
        return 10.0 if rate < 32000 else 5.0
    if free_bytes is None:
        try:
            free_bytes = torch.cuda.mem_get_info(torch.device(device))[0]
        except Exception:
            free_bytes = 2 * 1024**3
    free_gb = free_bytes / 1024**3
    return float(min(20.0, max(2.0, (0.6 * free_gb - 0.35) / (0.13 * rate / 16000))))


@torch.no_grad()
def enhance_chunked(segment, wav, sr, chunk_seconds, overlap_seconds, progress=None, check=None, window="crossfade"):
    """Run `segment(x (1, n)) -> (1, n)` over wav (C, N), a chunk at a time, joined by overlap-add.

    The input, the output and the weights stay where wav is (the CPU, from the node): `segment` moves each chunk to the
    model's device and its result comes back here, so only one chunk is ever in VRAM.

    window "crossfade": raised-cosine ramps over the overlap and weight 1 elsewhere (about 1.1x the work of one pass with
    10-20 s chunks and 1 s of overlap). "hann": the repo's inference_chunk.py, a Hann window over each chunk at 50% hop.
    `check()` runs before every chunk (ComfyUI's Cancel), `progress(done, total)` after it."""
    C, N = wav.shape
    chunk = max(1, int(round(chunk_seconds * sr)))
    if window == "hann":
        overlap = chunk // 2
    else:
        overlap = min(int(round(overlap_seconds * sr)), chunk // 2)
    spans = chunk_spans(N, chunk, overlap)
    total = C * len(spans)
    out = torch.zeros_like(wav)
    wsum = torch.zeros(N, device=wav.device)
    done = 0
    for c in range(C):
        for i, (s, e) in enumerate(spans):
            if check:
                check()
            y = segment(wav[c : c + 1, s:e]).to(wav.device)
            if len(spans) == 1:
                w = torch.ones(e - s, device=wav.device)
            elif window == "hann":
                w = torch.clamp(torch.hann_window(e - s, device=wav.device), min=1e-7)
            else:
                # The last chunk ends at N, so it can start earlier than the others: it fades in where the chunk before
                # fades out, and its samples before that are left to the chunk before.
                skip = max(0, spans[i - 1][1] - overlap - s) if i > 0 else 0
                w = crossfade_weights(e - s, overlap, skip, ramp_in=i > 0, ramp_out=i < len(spans) - 1, device=wav.device)
            out[c, s:e] += y[0] * w
            if c == 0:
                wsum[s:e] += w
            del y
            done += 1
            if progress:
                progress(done, total)
    return out / wsum.clamp(min=1e-7)


# ---------------------------------------------------------------- levels


def frame_rms_p(x, sr, q=0.95, frame_s=0.03):
    """The q-th quantile of 30 ms frame RMS over all channels (the speech level when q is high)."""
    n = max(1, int(sr * frame_s))
    mono = x.float().mean(0) if x.dim() > 1 else x.float()
    frames = mono.shape[-1] // n
    if frames < 1:
        return float(mono.pow(2).mean().sqrt())
    rms = mono[: frames * n].reshape(frames, n).pow(2).mean(1).sqrt()
    return float(torch.quantile(rms, q))


def lufs(x, sr):
    """Integrated loudness (ITU-R BS.1770, gated). x: (C, N)."""
    try:
        import torchaudio

        return float(torchaudio.functional.loudness(x.float().cpu(), sr))
    except Exception:
        return _lufs_fallback(x.float().cpu(), sr)


def _biquad(x, b, a):
    # One biquad over a channel (only used when torchaudio has no loudness()): scipy when it is there, else a loop.
    import numpy as np

    try:
        from scipy.signal import lfilter

        return lfilter(b, a, x)
    except Exception:
        pass
    y = np.zeros_like(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        o = b[0] * v + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
        x2, x1, y2, y1 = x1, v, y1, o
        y[i] = o
    return y


def _lufs_fallback(x, sr):
    import numpy as np

    # K-weighting: a high shelf (+4 dB above about 1.5 kHz) then a high-pass at about 38 Hz (BS.1770-4's 48 kHz design,
    # re-derived for this rate).
    f0, G, Q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    K = math.tan(math.pi * f0 / sr)
    Vh = 10 ** (G / 20)
    Vb = Vh**0.4996667741545416
    a0 = 1 + K / Q + K * K
    shelf_b = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
    shelf_a = [1.0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    f0, Q = 38.13547087602444, 0.5003270373238773
    K = math.tan(math.pi * f0 / sr)
    a0 = 1 + K / Q + K * K
    hp_b = [1.0, -2.0, 1.0]
    hp_a = [1.0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
    chans = [_biquad(_biquad(c.numpy().astype(np.float64), shelf_b, shelf_a), hp_b, hp_a) for c in x]
    block, step = int(0.4 * sr), int(0.1 * sr)
    if x.shape[-1] < block:
        z = sum(float(np.mean(c**2)) for c in chans)
        return -0.691 + 10 * math.log10(max(z, 1e-12))
    zs = np.array([sum(float(np.mean(c[s : s + block] ** 2)) for c in chans) for s in range(0, x.shape[-1] - block + 1, step)])
    loud = -0.691 + 10 * np.log10(np.maximum(zs, 1e-12))
    zs = zs[loud > -70]
    if not len(zs):
        return -70.0
    rel = -0.691 + 10 * math.log10(float(np.mean(zs))) - 10
    zs2 = zs[(-0.691 + 10 * np.log10(zs)) > rel]
    return -0.691 + 10 * math.log10(float(np.mean(zs2 if len(zs2) else zs)))


PEAK_CEILING = 10 ** (-1 / 20)  # -1 dBFS


def peak_limit(x, ceiling=PEAK_CEILING):
    """Scale x down (gain only) so its peak is at most `ceiling`."""
    peak = float(x.abs().max()) if x.numel() else 0.0
    return x * (ceiling / peak) if peak > ceiling else x
