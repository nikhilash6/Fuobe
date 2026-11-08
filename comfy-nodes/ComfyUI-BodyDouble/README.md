# ComfyUI-BodyDouble

Two ComfyUI nodes for Fuobe's Body Double: every person's double over their whole outline, clothes and hair included,
and their 3D body lined up with them.

- **Body Double Fit** (`BodyDoubleFit`): takes `MHR_POSE_DATA` (from ComfyUI-InstantHMR or ComfyUI's SAM 3D Body nodes)
  and moves each body so its 3D keypoints land on its own 2D keypoints in the picture. The 3D file, the pose render and
  the skeleton then sit on the person.
- **Body Double Look** (`BodyDoubleLook`): fills the people's mask (SAM 3) from the picture's own geometry (MoGe normals
  and depth) in one look:

  | Look | What it draws |
  |---|---|
  | `holo` | the surface normals: an iridescent sculpt of each person |
  | `clay` | the normals lit from above left: a matte sculpture |
  | `thermal` | a heat map, warmest where the body is nearest and faces the camera |
  | `ghost` | `holo` at half strength over the picture |
  | `xray` | a cyan glass outline with bright rims |
  | `skeleton` | the SCAIL skeleton render it is given |

  It works on a picture or every frame of a clip. Thermal and X-ray use one depth range for the whole clip, so the
  colours hold still from frame to frame.

Requirements: ComfyUI 0.42 or later (its SAM 3, MoGe and SAM 3D Body nodes). No other packages and no model files of
its own.

## Install

Copy this folder into `ComfyUI/custom_nodes/ComfyUI-BodyDouble` and restart ComfyUI.

## Licence

MIT (see `LICENSE`).
