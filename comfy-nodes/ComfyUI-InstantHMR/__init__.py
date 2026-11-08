# ComfyUI-InstantHMR (jtydhr88) @ 36d85573438e5de5d2fe63ba2dbca927c6a16c9b, trimmed for this server:
# only the loader and the predictor are registered. The Live Capture node, its /instanthmr/* routes
# (an unauthenticated websocket that writes recordings and can send UDP) and its web files are left out.
from typing_extensions import override

from comfy_api.latest import ComfyExtension, io

from .nodes import InstantHMRLoader, InstantHMRPredict


class InstantHMRExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [InstantHMRLoader, InstantHMRPredict]


async def comfy_entrypoint() -> InstantHMRExtension:
    return InstantHMRExtension()
