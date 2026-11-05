"""The checks Fuobe Connect makes itself, on this computer, whatever a studio sends.

A graph from a studio (a trusted page in direct mode, or the paired studio in pairing mode) runs only when:

- every node type is on the list that ships inside this pack (allowed_nodes.json: the nodes Fuobe's own workflows use),
  plus the types you list yourself in fuobe-connect-nodes.json in ComfyUI's user folder. A studio can never add to it;
- no text input names a path or an address: an absolute path, a drive letter, a network share, a ".." step, a home
  folder, a URL, or one of ComfyUI's folder tags ("name [output]", "name [temp]");
- every file loader reads one of the files Fuobe sent for the run (named fuobe_<id>.<ext>), never a file of yours and
  never a value that another node works out.

A result is downloaded only when this run's own history lists it. A model name is not checked here: ComfyUI itself
refuses a model name that isn't in your model folders.

Pure, so the tests run it alone.
"""

from __future__ import annotations

import json
import os
import re

# The names Fuobe gives the files it sends (src/server/computer/tasks.ts stageInput).
INPUT_NAME = re.compile(r"^fuobe_[A-Za-z0-9_-]{8,24}\.[a-z0-9]{1,5}$")
# The file types a run sends: pictures, clips, sound, 3D scenes, and plain data. Never a page, a script or a program.
INPUT_EXTS = frozenset(
    "png jpg jpeg jpe webp gif bmp tif tiff avif heic heif jxl exr hdr "
    "mp4 m4v mov webm mkv avi mpg mpeg wmv flv 3gp quick "
    "wav mp3 flac ogg oga opus m4a aac aif aiff wma xwav "
    "spz splat glb gltf ply obj fbx stl usdz "
    "npy npz txt json srt vtt csv bin octet".split()
)
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z")
TASK_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}\Z")
CLIENT_ID = re.compile(r"^fuobe-[A-Za-z0-9_-]{4,72}\Z")
# A run's filename prefix: fuobe/<generation id> (src/server/providers/comfyui.ts).
PREFIX = re.compile(r"^fuobe/[A-Za-z0-9_-]{6,64}\Z")

FILE_LOADERS = {
    "LoadImage": ["image"],
    "LoadImageMask": ["image"],
    "LoadImageOutput": ["image"],
    "LoadImageFuobeLive": ["image"],
    "LoadVideo": ["file"],
    "LoadAudio": ["audio"],
    "VHS_LoadVideo": ["video"],
    "VHS_LoadVideoPath": ["video"],
    "VHS_LoadAudio": ["audio_file"],
    "VHS_LoadAudioUpload": ["audio"],
    "VHS_LoadImages": ["directory"],
    "VHS_LoadImagesPath": ["directory"],
    # AusBoss's Crop + Rotate + Pad loads the upload itself.
    "AUSBOSS_NODES_ImageCropRotatePad": ["image"],
    # Any Angle's saved 3D view: the scene file, and the picture entries (checked one by one below).
    "Load3D": ["model_file"],
}
_FILEISH = re.compile(r"image|video|audio|file|path|directory", re.I)

_PATHLIKE = [
    re.compile(r"^[A-Za-z]:[\\/]"),  # C:\ or C:/
    re.compile(r"^\\\\"),  # \\server\share, \\?\C:\
    re.compile(r"^/(?!/)[^\s]*/"),  # /etc/passwd
    re.compile(r"^/(?!/)\S+\Z"),  # /secret.png
    re.compile(r"(^|[\\/])\.\.([\\/]|\Z)"),  # a ".." step
    re.compile(r"^~[\\/]"),  # ~/
    re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://"),  # a URL
    re.compile(r"^file:", re.I),
    re.compile(r"^blake3:", re.I),  # ComfyUI's asset names reach any registered file
    re.compile(r"\x00"),
]
_TAG = re.compile(r" \[(input|output|temp)\]\Z")


def staged_name_ok(name) -> bool:
    """A name Fuobe gives a file it sends: fuobe_<id>.<ext>, with a file type a run sends."""
    return isinstance(name, str) and bool(INPUT_NAME.match(name)) and name.rsplit(".", 1)[1] in INPUT_EXTS


def unsafe_text(v: str) -> bool:
    """A text input that names a path, an address or a folder tag."""
    return any(p.search(v) for p in _PATHLIKE)


# ---------------------------------------------------------------------------
# The node list


_HERE = os.path.dirname(os.path.abspath(__file__))
OWN_NODES_FILE = "fuobe-connect-nodes.json"


def shipped_nodes() -> frozenset:
    with open(os.path.join(_HERE, "allowed_nodes.json"), encoding="utf-8") as f:
        data = json.load(f)
    return frozenset(n for n in data.get("nodes", []) if isinstance(n, str))


def own_nodes(user_dir: str | None) -> frozenset:
    """The node types the person added in ComfyUI's user folder (a list, or {"nodes": [...]}); never from a studio."""
    if not user_dir:
        return frozenset()
    try:
        with open(os.path.join(user_dir, OWN_NODES_FILE), encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return frozenset()
    items = data.get("nodes") if isinstance(data, dict) else data
    return frozenset(n for n in items if isinstance(n, str)) if isinstance(items, list) else frozenset()


class NodeList:
    """The shipped list plus the person's own file, read again when that file changes."""

    def __init__(self, user_dir: str | None = None):
        self.user_dir = user_dir
        self.shipped = shipped_nodes()
        self._mtime = None
        self._own = frozenset()

    def __call__(self) -> frozenset:
        path = os.path.join(self.user_dir, OWN_NODES_FILE) if self.user_dir else None
        try:
            mtime = os.stat(path).st_mtime if path else None
        except OSError:
            mtime = None
        if mtime != self._mtime:
            self._mtime = mtime
            self._own = own_nodes(self.user_dir) if mtime is not None else frozenset()
        return self.shipped | self._own


# ---------------------------------------------------------------------------
# A graph


def _staged(v, staged) -> bool:
    """One of the run's own inputs (optionally tagged " [input]")."""
    if not isinstance(v, str):
        return False
    name = v[: -len(" [input]")] if v.endswith(" [input]") else v
    return staged_name_ok(name) and (staged is None or name in staged)


def graph_problem(graph, staged: list[str] | None) -> str | None:
    """Every file loader names one of this run's own inputs. `staged`: the run's input names (None: any name Fuobe
    gives an input, for direct mode, where the pack doesn't know the run). Else: what is wrong."""
    if not isinstance(graph, dict) or not graph:
        return "No graph"
    for node_id, node in graph.items():
        if not isinstance(node, dict):
            return f"Node {node_id} isn't a node"
        cls = node.get("class_type") if isinstance(node.get("class_type"), str) else ""
        inputs = node.get("inputs") if isinstance(node.get("inputs"), dict) else {}
        keys = FILE_LOADERS.get(cls)
        known = keys is not None
        if keys is None:
            keys = [k for k in inputs if _FILEISH.search(k)] if re.match(r"^(Load|VHS_Load)", cls) else []
        for k in keys:
            v = inputs.get(k)
            if v is None:
                continue
            if isinstance(v, list):
                # The studio names its files as values; a loader fed by another node could be fed any name.
                if known:
                    return f"Node {node_id} ({cls}) reads a file named by another node"
                continue
            if not _staged(v, staged):
                return f"Node {node_id} ({cls}) reads a file this run didn't send"
        if cls == "Load3D" and "image" in inputs:
            pics = inputs["image"]
            if isinstance(pics, dict):
                for f, x in pics.items():
                    if f == "camera_info" or x in ("", None):
                        continue
                    if not _staged(x, staged):
                        return f"Node {node_id} ({cls}) reads a file this run didn't send"
            elif pics not in ("", None):
                return f"Node {node_id} ({cls}) reads a file this run didn't send"
    return None


def vet_graph(graph, allowed: frozenset | set, staged: list[str] | None) -> str | None:
    """The first reason this graph may not run here, or None. The reasons are the worker program's
    ('unknown-node', 'unsafe-path') and 'unsafe-graph' for a loader that reads a file this run didn't send."""
    if not isinstance(graph, dict) or not graph or len(graph) > 5000:
        return "unsafe-graph"
    for node in graph.values():
        if not isinstance(node, dict) or not isinstance(node.get("class_type"), str) or node["class_type"] not in allowed:
            return "unknown-node"
    for node in graph.values():
        inputs = node.get("inputs")
        if inputs is None:
            continue
        if not isinstance(inputs, dict):
            return "unsafe-graph"
        for v in inputs.values():
            for s in _strings(v):
                if unsafe_text(s) or (_TAG.search(s) and not _staged(s, staged)):
                    return "unsafe-path"
    if graph_problem(graph, staged):
        return "unsafe-graph"
    return None


def _strings(v, depth: int = 0):
    """Every text in an input value (a picture entry list is a dict of texts). A link [node, slot] has none."""
    if isinstance(v, str):
        yield v
    elif isinstance(v, dict) and depth < 4:
        for x in v.values():
            yield from _strings(x, depth + 1)
    elif isinstance(v, list) and depth < 4 and not (len(v) == 2 and isinstance(v[0], str) and isinstance(v[1], int)):
        for x in v:
            yield from _strings(x, depth + 1)


# ---------------------------------------------------------------------------
# Results


def files_in(entries: list) -> list[dict]:
    out = []
    for e in entries or []:
        outputs = e.get("outputs") if isinstance(e, dict) else None
        for ui in (outputs or {}).values() if isinstance(outputs, dict) else []:
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
    if not isinstance(name, str) or not name or re.search(r"[\\/]", name) or name in (".", "..") or _TAG.search(name) or unsafe_text(name):
        return False
    if not isinstance(sub, str) or any(p == ".." for p in re.split(r"[\\/]", sub)) or sub.startswith(("/", "\\")) or re.match(r"^[A-Za-z]:", sub):
        return False
    return w.get("type") in ("output", "temp")


def has_prefix(prompt, prefix: str) -> bool:
    if not isinstance(prompt, dict) or not isinstance(prefix, str) or not prefix:
        return False
    return any(isinstance(n, dict) and isinstance(n.get("inputs"), dict) and n["inputs"].get("filename_prefix") == prefix for n in prompt.values())


def fuobe_prefixed(prompt) -> bool:
    """A prompt that saves under Fuobe's own prefix (fuobe/<generation id>): one of Fuobe's runs."""
    if not isinstance(prompt, dict):
        return False
    return any(
        isinstance(n, dict) and isinstance(n.get("inputs"), dict) and isinstance(n["inputs"].get("filename_prefix"), str) and PREFIX.match(n["inputs"]["filename_prefix"])
        for n in prompt.values()
    )


def run_prefix(prefix, graph) -> str | None:
    """The run's prefix when it is Fuobe's form and this run's own graph saves under it; else None."""
    if isinstance(prefix, str) and PREFIX.match(prefix) and has_prefix(graph, prefix):
        return prefix
    return None


_ABS_PATH = re.compile(r"(?:[A-Za-z]:[\\/]|\\\\|(?<![\w.~-])/(?=[^\s/'\"]+/))[^\s'\"<>|]*")
_LIST = re.compile(r"\s*not in \[.*", re.S)


def scrub(text, limit: int = 300):
    """ComfyUI's words without folders on this computer or lists of your files, cut short."""
    if not isinstance(text, str):
        return None
    return _ABS_PATH.sub("<path>", _LIST.sub(" not in the list", text[: limit * 4]))[:limit]


def _slim_status(status):
    if not isinstance(status, dict):
        return status
    out = {k: status.get(k) for k in ("status_str", "completed") if k in status}
    msgs = []
    for m in status.get("messages") or []:
        if not (isinstance(m, list) and len(m) == 2 and isinstance(m[0], str) and isinstance(m[1], dict)):
            continue
        d = m[1]
        keep = {k: d[k] for k in ("prompt_id", "node_id", "node_type", "timestamp") if k in d}
        if "exception_message" in d:
            keep["exception_message"] = scrub(d.get("exception_message"), 600)
        if "exception_type" in d:
            keep["exception_type"] = scrub(d.get("exception_type"), 120)
        msgs.append([m[0], keep])
    out["messages"] = msgs[:50]
    return out


def slim(e: dict) -> dict:
    """A history entry as the studio needs it: its status and outputs, not the whole graph again, and no traceback."""
    p = e.get("prompt")
    return {
        "prompt": [p[0], p[1]] if isinstance(p, list) and len(p) >= 2 else None,
        "status": _slim_status(e.get("status")),
        "outputs": e.get("outputs"),
    }


def refusal(answer, sent: set | None = None) -> dict:
    """ComfyUI's 400 answer to a prompt, as the studio needs it to say what was missing: the error types, the node
    classes, and the values the graph itself sent, without lists of your files or folders on this computer."""
    out: dict = {}
    if not isinstance(answer, dict):
        return out
    err = answer.get("error")
    if isinstance(err, dict):
        e = {k: scrub(err.get(k), n) for k, n in (("type", 80), ("message", 300)) if isinstance(err.get(k), str)}
        info = err.get("extra_info")
        if isinstance(info, dict) and isinstance(info.get("class_type"), str):
            e["extra_info"] = {"class_type": info["class_type"][:128]}
        out["error"] = e
    nodes = answer.get("node_errors")
    if isinstance(nodes, dict):
        slim_nodes = {}
        for nid, n in list(nodes.items())[:24]:
            if not isinstance(n, dict):
                continue
            errors = []
            for x in (n.get("errors") or [])[:6]:
                if not isinstance(x, dict):
                    continue
                item = {k: scrub(x.get(k), 300) for k in ("type", "message", "details") if isinstance(x.get(k), str)}
                info = x.get("extra_info") if isinstance(x.get("extra_info"), dict) else {}
                extra = {}
                if isinstance(info.get("input_name"), str):
                    extra["input_name"] = info["input_name"][:64]
                got = info.get("received_value")
                if isinstance(got, str) and len(got) <= 256 and (sent is None or got in sent):
                    extra["received_value"] = got
                if extra:
                    item["extra_info"] = extra
                errors.append(item)
            slim_node = {"errors": errors}
            if isinstance(n.get("class_type"), str):
                slim_node["class_type"] = n["class_type"][:128]
            slim_nodes[str(nid)[:32]] = slim_node
        out["node_errors"] = slim_nodes
    return out


def graph_strings(graph) -> set:
    """Every text a graph's nodes take."""
    out = set()
    for node in graph.values() if isinstance(graph, dict) else []:
        if isinstance(node, dict) and isinstance(node.get("inputs"), dict):
            for v in node["inputs"].values():
                out.update(_strings(v))
    return out
