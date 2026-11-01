"""Checks Fuobe Connect makes on its own, whatever the studio sends (the same ones the Fuobe tab makes):

- a job's graph may read only the input files that job sent (no file of yours);
- a result is downloaded only when this job's own prompt saved it.

Pure, so the tests run it alone.
"""

from __future__ import annotations

import re

INPUT_NAME = re.compile(r"^fuobe_[A-Za-z0-9_-]{8,24}\.[a-z0-9]{1,5}$")
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")

FILE_LOADERS = {
    "LoadImage": ["image"],
    "LoadImageMask": ["image"],
    "LoadImageOutput": ["image"],
    "LoadVideo": ["file"],
    "LoadAudio": ["audio"],
    "VHS_LoadVideo": ["video"],
    "VHS_LoadVideoPath": ["video"],
    "VHS_LoadAudio": ["audio_file"],
    "VHS_LoadAudioUpload": ["audio"],
    "VHS_LoadImages": ["directory"],
    "VHS_LoadImagesPath": ["directory"],
}
_FILEISH = re.compile(r"image|video|audio|file|path|directory", re.I)


def graph_problem(graph, staged: list[str]) -> str | None:
    """Every loader names one of this job's own inputs, or a value from another node. Else: what is wrong."""
    if not isinstance(graph, dict):
        return "No graph"
    for node_id, node in graph.items():
        if not isinstance(node, dict):
            return f"Node {node_id} isn't a node"
        cls = node.get("class_type") if isinstance(node.get("class_type"), str) else ""
        inputs = node.get("inputs") if isinstance(node.get("inputs"), dict) else {}
        keys = FILE_LOADERS.get(cls)
        if keys is None:
            keys = [k for k in inputs if _FILEISH.search(k)] if re.match(r"^(Load|VHS_Load)", cls) else []
        for k in keys:
            v = inputs.get(k)
            if v is None or isinstance(v, list):
                continue
            if not isinstance(v, str) or re.sub(r" \[input\]$", "", v) not in staged:
                return f"Node {node_id} ({cls}) reads a file this run didn't send"
    return None


def files_in(entries: list) -> list[dict]:
    out = []
    for e in entries or []:
        outputs = e.get("outputs") if isinstance(e, dict) else None
        for ui in (outputs or {}).values():
            if not isinstance(ui, dict):
                continue
            for v in ui.values():
                if isinstance(v, list):
                    for f in v:
                        if isinstance(f, dict) and isinstance(f.get("filename"), str) and isinstance(f.get("type"), str):
                            out.append(f)
    return out


def may_download(w: dict, entries: list) -> bool:
    return any(
        x["filename"] == w.get("filename") and (x.get("subfolder") or "") == w.get("subfolder") and x["type"] == w.get("type") for x in files_in(entries)
    )


def safe_wanted(w: dict) -> bool:
    """A wanted file the server named: a plain file name in output or temp, no way out of the folder."""
    name = w.get("filename")
    sub = w.get("subfolder") or ""
    if not isinstance(name, str) or not name or re.search(r"[\\/]", name) or name in (".", ".."):
        return False
    if not isinstance(sub, str) or any(p == ".." for p in re.split(r"[\\/]", sub)):
        return False
    return w.get("type") in ("output", "temp")


def has_prefix(prompt, prefix: str) -> bool:
    if not isinstance(prompt, dict):
        return False
    return any(isinstance(n, dict) and isinstance(n.get("inputs"), dict) and n["inputs"].get("filename_prefix") == prefix for n in prompt.values())


def slim(e: dict) -> dict:
    """A history entry as the studio needs it: its status and outputs, not the whole graph again."""
    p = e.get("prompt")
    return {
        "prompt": [p[0], p[1]] if isinstance(p, list) and len(p) >= 2 else None,
        "status": e.get("status"),
        "outputs": e.get("outputs"),
    }
