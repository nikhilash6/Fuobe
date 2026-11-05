# TRIBE v2 worker (optional, non-commercial)

The parity studio's Virality Predictor returns a per-second engagement curve, a peak, a hook score for the first
3 seconds and five cortical regions on the fsaverage mesh. That output matches Meta's open brain-encoding
model **TRIBE v2** (`facebook/tribev2`). Fuobe does not bundle it, and no cloud provider hosts it. The
`/virality` page shows Fuobe's labelled heuristic hook check and never shows a score.

This page describes the worker Fuobe would call if you run TRIBE v2 yourself.

## Licence

- TRIBE v2 weights: **CC BY-NC 4.0**. Non-commercial use only. You can't use its scores for client or
  paid work.
- TRIBE v2 is built from V-JEPA2 (video), Wav2Vec-BERT (audio) and **Llama-3.2-3B** (text). Llama-3.2-3B
  is gated on Hugging Face. Accept Meta's licence on the model page and give the worker a Hugging Face
  token that has access.
- The scores are predictive proxies of modelled brain responses. They are not view forecasts or clinical
  measures. The parity studio shows the same disclaimer.

## Worker contract

The worker is a separate HTTP service on your own GPU, outside ComfyUI, like the isolated LatentSync
worker described in `scripts/comfy/README.md`.

`POST {TRIBE_URL}/analyze`, with `multipart/form-data` field `video` (MP4, up to 60 s), returns this JSON:

```json
{
  "duration": 12.4,
  "engagement": [41, 58, 72, 66],
  "peak_t": 2,
  "peak_val": 72,
  "hook_score": 57,
  "regions": {
    "visual_occipital": [0.42, 0.61, 0.70, 0.55],
    "frontoparietal_attention": [0.30, 0.48, 0.52, 0.47],
    "auditory_temporal": [0.22, 0.35, 0.41, 0.38],
    "language_frontotemporal": [0.18, 0.20, 0.33, 0.29],
    "default_mode": [0.51, 0.40, 0.31, 0.36]
  },
  "model": "facebook/tribev2",
  "disclaimer": "Predictive proxy metrics, not guaranteed performance or clinical measures."
}
```

| Field | Meaning |
|---|---|
| `duration` | Length of the analysed video, in seconds. |
| `engagement` | One value per second, normalised to 0–100. |
| `peak_t`, `peak_val` | The second with the highest engagement, and that value. |
| `hook_score` | Mean engagement over 0–3 s, 0–100. |
| `regions` | Mean activation per second for each of the 5 fsaverage regions. For `default_mode` ("focus drift"), lower is better. |

`GET {TRIBE_URL}/health` returns `{ "ok": true, "model": "facebook/tribev2" }`.

## Status in Fuobe

The contract is documented only. Fuobe has no setting for `TRIBE_URL` yet. Until there is one, `/virality`
keeps its heuristic analysis in the browser, and the page says so on both engines.
