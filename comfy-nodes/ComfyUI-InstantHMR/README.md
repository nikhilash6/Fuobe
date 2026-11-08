# ComfyUI-InstantHMR (Fuobe's pinned form)

InstantHMR for ComfyUI: one MHR body (pose, shape, hands, 70 keypoints and the mesh) for every person in a picture or
every frame of a clip, as `MHR_POSE_DATA` for ComfyUI's own SAM 3D Body nodes. Fuobe's Body Double runs on it.

This is jtydhr88's ComfyUI-InstantHMR with only its two processing nodes registered: **Load InstantHMR Model** and
**Run InstantHMR Prediction**. See `NOTICE` for what differs from the original.

## Install

Copy this folder into `ComfyUI/custom_nodes/ComfyUI-InstantHMR` and restart ComfyUI. Put the checkpoint in
`ComfyUI/models/detection/`:

| File | Download (pinned revision) | Bytes | SHA-256 |
|---|---|---|---|
| `instanthmr_medium.safetensors` | https://huggingface.co/jtydhr88/ComfyUI-InstantHMR/resolve/964effb58c3358ca8a0e35da386f49de1480ac9e/instanthmr_medium.safetensors | 180,730,516 | `76bd71c76683b5c0ea156b8b9c527b8f392832701c3a0377f81b8ba14277ca5e` |
| `instanthmr_medium_commercial.safetensors` (commercial use allowed under the SAM License) | https://huggingface.co/jtydhr88/ComfyUI-InstantHMR/resolve/964effb58c3358ca8a0e35da386f49de1480ac9e/instanthmr_medium_commercial.safetensors | 180,730,516 | `6fb700552d994da13f8c35434dbcd5836ee01eeba1bba7026764cf06fb7c7d42` |

Requirements: ComfyUI 0.42 or later (its SAM 3D Body and RT-DETR nodes). No other packages.

## Licence

Code: Apache-2.0 (`LICENSE`, `NOTICE`). The InstantHMR weights are under the SAM License; the medium file is
non-commercial, the medium_commercial file allows commercial use under its terms.
