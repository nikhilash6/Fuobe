from typing_extensions import override

from comfy_api.latest import ComfyExtension, io

from .nodes import NODES


class BodyDoubleExtension(ComfyExtension):
    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return NODES


async def comfy_entrypoint() -> BodyDoubleExtension:
    return BodyDoubleExtension()
