"""The checks Fuobe Connect makes itself, on this computer, whatever a studio sends.

A graph from a studio (a trusted page in direct mode, or the paired studio in pairing mode) runs only when:

- every node type is on the list that ships inside this pack (allowed_nodes.json: the nodes Fuobe's own workflows use),
  plus the types you list yourself in fuobe-connect-nodes.json in ComfyUI's user folder. A studio can never add to it;
- no text names a place: an absolute path in any form ("/x", "\\x", "//host/share", "\\\\?\\C:\\x", "C:\\x", "C:x"), a
  ".." step, a home folder ("~", "~user"), an environment variable at the start ("$HOME/", "%USERPROFILE%\\"), a URL,
  one of ComfyUI's folder tags ("name [output]", "name [temp]"), or a JSON key that names a file, folder or address
  ("video_path": ...). The check looks at the text after its leading spaces and quotes, as a node that trims it sees it;
- every input that a listed node reads as a file or a folder (PATH_INPUTS) holds a value the graph writes itself, in the
  one form Fuobe's own graphs use. It never takes a link: another node could work out any text;
- every file loader reads one of the files Fuobe sent for the run (named fuobe_<id>.<ext>), never a file of yours and
  never a value that another node works out;
- a value the graph writes is never a JSON object, except a 3D view's entries: ComfyUI hands an object to a node
  unchecked, and some nodes read a file's path from one;
- a few inputs take only a link from one node type, or text of one shape (LINK_INPUTS, TEXT_INPUTS).

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
    # Hi3D's coarse mesh: any file in the input folder by name.
    "Hi3DLoadMesh": ["mesh_file"],
}
# Loaders whose file is optional: "" (no file) or one of the run's own inputs.
OPTIONAL_FILES = {
    # A continuation history (.npz) read from the input folder.
    "H3CharacterSwapShot": ["history_file"],
}
_FILEISH = re.compile(r"image|video|audio|file|path|directory", re.I)

_PATHLIKE = [
    re.compile(r"^[\\/]"),  # /etc/passwd, \Users\x, //host/share, //?/C:/x, \\host\share, \\?\C:\x, \/host/share
    re.compile(r"^[A-Za-z]:(?![ \t])"),  # C:\x, C:/x, and C:x or D:Users\x (a drive with no slash)
    re.compile(r"^~(?!\s)"),  # ~, ~/x, ~user/x
    re.compile(r"^(?:\$\{?[A-Za-z_][A-Za-z0-9_]*\}?|%[A-Za-z_][A-Za-z0-9_]*%)(?:[\\/]|\Z)"),  # $HOME/x, %USERPROFILE%\x
    re.compile(r"(^|[\\/])\.\.([\\/]|\Z)"),  # a ".." step
    re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://"),  # a URL
    re.compile(r"^file:", re.I),
    re.compile(r"^blake3:", re.I),  # ComfyUI's asset names reach any registered file
    re.compile(r"\x00"),
]
# A key in JSON (or a Python dict) inside a text: "video_path": ..., 'output_folder': ...
_KEY = re.compile(r"""["']([A-Za-z0-9_.-]{1,64})["']\s*:""")
_PLACE_KEY = re.compile(r"(?:^|[_.-])(?:paths?|files?|file_?names?|file_?paths?|dirs?|directory|folders?|urls?|uris?|roots?|assets?|href|src)\Z", re.I)
_TAG = re.compile(r" \[(input|output|temp)\]\Z")
_QUOTES = "\"'`"


def staged_name_ok(name) -> bool:
    """A name Fuobe gives a file it sends: fuobe_<id>.<ext>, with a file type a run sends."""
    return isinstance(name, str) and bool(INPUT_NAME.match(name)) and name.rsplit(".", 1)[1] in INPUT_EXTS


def _trimmed(v: str) -> str:
    """The text as a node that trims spaces and quotes from its start sees it."""
    while True:
        t = v.lstrip().lstrip(_QUOTES)
        if t == v:
            return t
        v = t


def unsafe_text(v: str) -> bool:
    """A text that names a path, an address, a folder tag, or a file inside JSON."""
    t = _trimmed(v)
    return any(p.search(t) for p in _PATHLIKE) or any(_PLACE_KEY.search(k) for k in _KEY.findall(v))


# ---------------------------------------------------------------------------
# Inputs with rules of their own


_NAME = r"[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}"  # one file or folder name: it never starts with a dot, so it is never ".."
_NONE = re.compile(r"")  # only "": the node's own default, no file

# Inputs that a listed node reads as a file or a folder. Each one takes only a value the graph writes itself, in the one
# form Fuobe's own graphs use; never a link. Every text input of every node on the shipped list was read in that node's
# source (at the commits Fuobe's workflows/comfyui/requirements.json pins); the others are words, numbers or data that
# no node opens as a file, or names that the node itself keeps inside ComfyUI's own folders.
PATH_INPUTS: dict[str, dict[str, re.Pattern]] = {
    # Writes a subtitle file at this path (an absolute one as given, else under the output folder).
    "AILab_Qwen3ASRSubtitle": {"output_path": re.compile(r"(?:fuobe(?:/[A-Za-z0-9_-]{1,64}){1,4})?")},
    # Model files, with $VARS and ~ expanded; a relative path is under the pack's own folder.
    "AuKModelLoader": {
        "checkpoint_path": re.compile(rf"ckpts/{_NAME}/{_NAME}\.safetensors"),
        "config_path": _NONE,
        "qwen_path": re.compile(rf"(?:ckpts/{_NAME})?"),
    },
    # A model folder ("" is ComfyUI's models/Hi3D).
    "Hi3DModelLoader": {"model_root": _NONE},
    # Opens any video or sound file at these paths.
    "MiniMaxH3SourceTimeline": {"video_path": _NONE, "audio_path": _NONE},
    # The run's own folder under output/h3_chains: Fuobe's jobs are named fuobe_<id> (or come from the swap plan nodes).
    "MiniMaxH3ChainPlanModern": {"run_name": re.compile(r"fuobe_[A-Za-z0-9_-]{0,60}[A-Za-z0-9]")},
    # A latent saved in output/open_h3_latents: only one a Fuobe draft saved (fuobe_h3_<id>_00001), never "(newest)",
    # which would be whatever was saved last, yours too.
    "OpenH3LoadRefinedLatent": {"latent_file": re.compile(r"fuobe_[A-Za-z0-9_-]{1,96}_\d{5}\.safetensors")},
    # A SAM model in models/sams, else a path from ComfyUI's working folder (loaded with torch).
    "QWMRefineMask": {"sam_model": re.compile(r"sam_vit_[bhl][A-Za-z0-9_.-]{0,64}\.pth")},
    # Writes every window's frames into this folder.
    "WanVideoImageToVideoMultiTalk": {"output_path": _NONE},
    # A model folder, the adapter file and the text encoder (a folder, or a Hugging Face id it downloads).
    "ZenImage21AdapterLoader": {
        "model_folder": _NONE,
        "adapter_file": re.compile(rf"models/text_encoders/{_NAME}\.safetensors"),
        "text_encoder": re.compile(rf"Qwen/Qwen3\.5-0\.8B|models/text_encoders/{_NAME}"),
    },
}

# Inputs that may also (or only) take a link, but only from these node types.
_SWAP_PLANS = frozenset({"H3AdvancedSwapPlan", "H3ObjectSwapPlan", "H3OneClickSwapPlan", "H3PictureSwapPlan", "H3SceneSwapPlan", "H3MontagePlan"})
LINK_INPUTS: dict[str, dict[str, frozenset]] = {
    # The swap plan nodes name their runs from a hash of their inputs.
    "MiniMaxH3ChainPlanModern": {"run_name": _SWAP_PLANS},
    # An SVG that ComfyUI saves into the output folder: only the vectorizer's own.
    "TS_SVGStringToSVGBytesIO": {"SVG_String": frozenset({"TS_ImageToSVGStringColor_Vtracer"})},
}

# A replacement field that reads an attribute or an item ("{a.__class__}", "{a[0]}"): Python's format can reach a
# module's globals (os.environ) through a node's object.
_FIELD_ACCESS = re.compile(r"(?<!\{)(?:\{\{)*\{[^{}!:]*[.\[]")

# Text inputs that must have one shape (a value the graph writes; never a link).
TEXT_INPUTS: dict[str, dict] = {
    "StringFormat": {"f_string": lambda s: not _FIELD_ACCESS.search(s)},
}

# The only inputs that take a JSON object the graph writes: a 3D view's entries (Load3D's are checked below).
OBJECT_INPUTS = frozenset({("Load3D", "image"), ("Save3DAdvanced", "viewport_state")})


def is_link(v) -> bool:
    """[node id, output slot]: a value another node works out."""
    return isinstance(v, list) and len(v) == 2 and isinstance(v[0], str) and isinstance(v[1], int) and not isinstance(v[1], bool)


def input_problem(graph: dict, cls: str, key: str, v) -> str | None:
    """What is wrong with one input under its node's own rule: 'unsafe-path', 'unsafe-graph', or None."""
    if isinstance(v, dict) and (cls, key) not in OBJECT_INPUTS:
        return "unsafe-graph"
    links = LINK_INPUTS.get(cls, {}).get(key)
    if is_link(v) and links is not None:
        src = graph.get(v[0])
        return None if isinstance(src, dict) and src.get("class_type") in links else "unsafe-graph"
    form = PATH_INPUTS.get(cls, {}).get(key)
    if form is not None:
        return None if isinstance(v, str) and form.fullmatch(v) else "unsafe-path"
    shape = TEXT_INPUTS.get(cls, {}).get(key)
    if shape is not None:
        return None if isinstance(v, str) and shape(v) else "unsafe-path"
    if links is not None:
        return "unsafe-graph"
    return None


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
        for k in OPTIONAL_FILES.get(cls, []):
            v = inputs.get(k)
            if v is None or v == "":
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
    ('unknown-node', 'unsafe-path') and 'unsafe-graph': a loader that reads a file this run didn't send, a JSON object
    the graph writes, or a link from a node that may not feed that input."""
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
        for k, v in inputs.items():
            for s in _strings(v):
                if unsafe_text(s) or (_TAG.search(s) and not _staged(s, staged)):
                    return "unsafe-path"
            why = input_problem(graph, node["class_type"], k, v)
            if why:
                return why
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
