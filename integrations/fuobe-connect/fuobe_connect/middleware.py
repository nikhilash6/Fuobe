"""The middleware that lets a trusted Fuobe studio use this ComfyUI from the browser, with no start flag.

ComfyUI turns away every request from another website (its origin check). This middleware runs before that check and
handles exactly one case: a request from a trusted studio (an exact origin) to this ComfyUI on this computer (the Host
is 127.0.0.1, ::1 or localhost) for a path a Fuobe run needs (origins.allowed). For that request it:

- answers the browser's CORS preflight, and Chrome's Private Network Access preflight, for that origin only;
- checks what the request asks for, here in Python, whatever the studio's own page checked (Studios.check): a prompt
  runs only with the node types this pack ships (graph.py) and reads only files Fuobe sent; an upload goes only into
  the input folder under a name Fuobe gives (fuobe_<id>.<ext>); a studio may take off, cancel, read or download only
  the prompts it queued and their results;
- passes the request on without its Origin and Sec-Fetch-Site headers, so ComfyUI's own check sees what it sees for a
  program on this computer, and adds Access-Control-Allow-Origin for that origin to the answer;
- shows the studio only its own prompts in the queue, the history and the job list, and never the names of the files
  in your input folder (Studios.answer).

Every other request goes on untouched, so ComfyUI's own check still turns away every other website.

When ComfyUI was started with --enable-cors-header (which switches its own check off), the middleware also does what
Fuobe's guard does: a request from a web page gets in only when the page is ComfyUI's own, the origin the setting
names, or a trusted studio. With "--enable-cors-header *" (every site, the person's choice) it adds no check.

Pure aiohttp: the tests load it with ComfyUI's own middleware and nothing else.
"""

from __future__ import annotations

import json
import logging
from collections import OrderedDict
from typing import Callable, Iterable

from aiohttp import web

from .graph import CLIENT_ID, FILE_LOADERS, UUID, fuobe_prefixed, files_in, staged_name_ok, vet_graph
from .origins import allowed, host_name, is_loopback, normalise, same_host

ALLOW_METHODS = "GET, POST, OPTIONS"
# Set on a trusted studio's request as it goes on (and dropped from every incoming one), so Fuobe Connect's own status
# answer gives a studio less than ComfyUI's own page.
MARKER = "X-Fuobe-Connect-Studio"
ALLOW_HEADERS = {"content-type"}
MAX_AGE = "600"

_told: set[str] = set()


def _note(why: str) -> None:
    if why not in _told and len(_told) < 50:
        _told.add(why)
        logging.warning("[Fuobe Connect] Turned away a request from %s", why)


def _cors_headers(origin: str) -> dict[str, str]:
    return {"Access-Control-Allow-Origin": origin, "Vary": "Origin"}


def preflight(request: web.Request, origin: str) -> web.Response | None:
    """The answer to a preflight from a trusted origin, or None when it asks for something a run never does."""
    method = request.headers.get("Access-Control-Request-Method", "").upper()
    if not method or not allowed(method, request.path, request.query_string):
        return None
    asked = {h.strip().lower() for h in request.headers.get("Access-Control-Request-Headers", "").split(",") if h.strip()}
    if not asked <= ALLOW_HEADERS:
        return None
    headers = {
        **_cors_headers(origin),
        "Access-Control-Allow-Methods": ALLOW_METHODS,
        "Access-Control-Max-Age": MAX_AGE,
    }
    if asked:
        headers["Access-Control-Allow-Headers"] = ", ".join(sorted(asked))
    # Chrome's Private Network Access: a public page asking for an app on this computer.
    if request.headers.get("Access-Control-Request-Private-Network", "").lower() == "true":
        headers["Access-Control-Allow-Private-Network"] = "true"
    return web.Response(status=204, headers=headers)


GUARD_PATHS = ("/fuobe/guard", "/api/fuobe/guard")


async def _pass(request: web.Request, handler):
    """The request goes on to ComfyUI, except Fuobe's guard question: Fuobe Connect answers it (it keeps other websites
    out, as the guard did), so a Fuobe page that asks for the guard hears yes. Answered here, never as a route, so a
    guard file installed beside it can't clash with it."""
    if request.method == "GET" and request.path in GUARD_PATHS:
        return web.json_response({"guard": 1, "connect": 1})
    return await handler(request)


def _bare(path: str) -> str:
    return path[4:] if path.startswith("/api/") else path


def _refuse(message: str, status: int = 403) -> web.Response:
    return web.json_response({"error": {"type": "fuobe_connect_refused", "message": message}}, status=status)


# What a refused graph means, in words the studio shows the person.
REASONS = {
    "unknown-node": "Fuobe Connect on this computer doesn't run one of this workflow's node types. Update Fuobe Connect in ComfyUI-Manager, then retry.",
    "unsafe-path": "Fuobe Connect refused this workflow: it names a folder, a file path or a web address on this computer.",
    "unsafe-graph": "Fuobe Connect refused this workflow: it reads a file Fuobe didn't send.",
}

_PROMPT_KEYS = {"prompt", "prompt_id", "client_id", "extra_data", "front"}
_UPLOAD_FIELDS = {"image", "type", "subfolder", "overwrite"}


class Studios:
    """What trusted studios did here: the prompts they queued (and a batch's later passes), and the result files their
    prompts' history showed them. A studio may touch only those. Kept in memory: ComfyUI's queue and history are too."""

    KEEP = 4096

    def __init__(self, nodes: Callable[[], Iterable[str]] | None = None):
        self.nodes = nodes or (lambda: frozenset())
        self.prompts: OrderedDict[str, None] = OrderedDict()
        self.files: OrderedDict[tuple, None] = OrderedDict()

    @staticmethod
    def _keep(d: OrderedDict, key):
        d[key] = None
        d.move_to_end(key)
        while len(d) > Studios.KEEP:
            d.popitem(last=False)

    def own(self, pid) -> bool:
        return isinstance(pid, str) and pid in self.prompts

    def add_prompt(self, pid: str):
        self._keep(self.prompts, pid)

    def add_files(self, entry):
        for f in files_in([entry]):
            self._keep(self.files, (f["filename"], f.get("subfolder") or "", f["type"]))

    def has_file(self, filename: str, subfolder: str, kind: str) -> bool:
        return (filename, subfolder or "", kind or "output") in self.files

    # ------------------------------------------------------------------
    # Requests

    async def check(self, request: web.Request) -> web.StreamResponse | None:
        """None when the request may go on; else the answer instead of ComfyUI's."""
        p = _bare(request.path)
        if request.method == "POST":
            if p == "/upload/image":
                return await self._upload(request)
            if p.startswith("/customnode/") or p.startswith("/v2/customnode/"):
                return None
            try:
                body = await request.json()
            except (ValueError, UnicodeDecodeError):
                return _refuse("Not JSON", 400)
            if p == "/prompt":
                return self._prompt(body)
            if p in ("/queue", "/history"):
                ids = body.get("delete") if isinstance(body, dict) and set(body) == {"delete"} else None
                if not isinstance(ids, list) or not ids or not all(self.own(i) for i in ids):
                    return _refuse("A studio may take off only its own prompts")
                return None
            if p == "/interrupt":
                if not (isinstance(body, dict) and self.own(body.get("prompt_id"))):
                    return _refuse("A studio may stop only its own prompt")
                return None
            if p.startswith("/jobs/") and p.endswith("/cancel"):
                return None if self.own(p.split("/")[2]) else _refuse("A studio may cancel only its own prompts")
            return _refuse("Not a run's request")
        if p.startswith("/history/"):
            return None if self.own(p[9:]) else web.json_response({})
        if p.startswith("/jobs/"):
            return None if self.own(p[6:]) else web.json_response({"error": "Job not found"}, status=404)
        if p == "/view":
            q = request.query
            if not self.has_file(q.get("filename", ""), q.get("subfolder", ""), q.get("type", "output")):
                return _refuse("A studio may download only its own prompts' results")
        return None

    def _prompt(self, body) -> web.Response | None:
        if not isinstance(body, dict) or set(body) - _PROMPT_KEYS:
            return _refuse("Not a run's prompt", 400)
        pid = body.get("prompt_id")
        if not isinstance(pid, str) or not UUID.match(pid):
            return _refuse("A run's prompt has its own id", 400)
        cid = body.get("client_id")
        if cid is not None and not (isinstance(cid, str) and CLIENT_ID.match(cid)):
            return _refuse("Not a Fuobe client id", 400)
        extra = body.get("extra_data")
        if extra is not None and not (isinstance(extra, dict) and set(extra) <= {"preview_method"} and isinstance(extra.get("preview_method", ""), str)):
            return _refuse("Not a run's prompt", 400)
        if "front" in body and not isinstance(body["front"], bool):
            return _refuse("Not a run's prompt", 400)
        why = vet_graph(body.get("prompt"), frozenset(self.nodes()), None)
        if why:
            _note(f"a trusted studio: its workflow was refused ({why})")
            return _refuse(REASONS[why], 400)
        if self.own(pid):
            return _refuse("That prompt id is taken", 400)
        self.add_prompt(pid)
        return None

    async def _upload(self, request: web.Request) -> web.Response | None:
        try:
            form = await request.post()
        except Exception:
            return _refuse("Not an upload", 400)
        if set(form.keys()) - _UPLOAD_FIELDS or len(form.getall("image", [])) != 1:
            return _refuse("Not a run's upload")
        image = form.get("image")
        name = getattr(image, "filename", None)
        if not staged_name_ok(name):
            return _refuse("A studio may upload only a run's own inputs (fuobe_<id> pictures, clips and sound)")
        if form.get("type", "input") not in ("", "input") or form.get("subfolder", "") != "":
            return _refuse("A studio may upload only into the input folder")
        return None

    # ------------------------------------------------------------------
    # Answers

    async def answer(self, request: web.Request, response: web.StreamResponse) -> web.StreamResponse:
        """The answer as a studio may see it."""
        if not isinstance(response, web.Response) or response.status != 200:
            return response
        p = _bare(request.path)
        if request.method == "POST":
            if p == "/prompt":
                # An older ComfyUI names the prompt itself: that id is the studio's too.
                try:
                    pid = json.loads(response.body).get("prompt_id")
                except Exception:
                    pid = None
                if isinstance(pid, str) and len(pid) <= 64:
                    self.add_prompt(pid)
            return response
        if p == "/queue" or p == "/jobs" or p == "/history" or p.startswith("/history/") or p == "/object_info" or p.startswith("/object_info/"):
            try:
                data = json.loads(response.body if isinstance(response.body, (bytes, bytearray)) else response.text)
            except Exception:
                return _refuse("Fuobe Connect couldn't read ComfyUI's answer", 502)
            if p == "/queue":
                data = self._queue(data)
            elif p == "/jobs":
                data = self._jobs(data)
            elif p.startswith("/history"):
                data = self._history(data, single=p != "/history")
            else:
                data = _hide_inputs(data)
            return web.json_response(data)
        return response

    def _history(self, data, single: bool):
        if not isinstance(data, dict):
            return {}
        out = {}
        for pid, entry in data.items():
            prompt = entry.get("prompt") if isinstance(entry, dict) else None
            mine = single or self.own(pid) or (isinstance(prompt, list) and len(prompt) > 2 and fuobe_prefixed(prompt[2]))
            if mine and isinstance(pid, str):
                if not single:
                    self.add_prompt(pid)
                self.add_files(entry)
                out[pid] = entry
        return out

    def _queue(self, data):
        if not isinstance(data, dict):
            return {}
        out = {}
        for k in ("queue_running", "queue_pending"):
            items = []
            for r in data.get(k) or []:
                if not isinstance(r, list) or len(r) < 3:
                    continue
                if self.own(r[1]) or fuobe_prefixed(r[2]):
                    if isinstance(r[1], str):
                        self.add_prompt(r[1])
                    items.append(r)
                else:
                    # Someone else's prompt: only its place in the queue.
                    items.append([r[0], None, None, {}, []])
            out[k] = items
        return out

    def _jobs(self, data):
        if not isinstance(data, dict):
            return {"jobs": []}
        out = dict(data)
        out["jobs"] = [j for j in data.get("jobs") or [] if isinstance(j, dict) and self.own(j.get("id"))]
        return out


def _hide_inputs(info):
    """/object_info without the names of the files in your input folder (a loader's list keeps only Fuobe's own)."""
    if not isinstance(info, dict):
        return info
    for cls, spec in info.items():
        inputs = spec.get("input") if isinstance(spec, dict) else None
        if not isinstance(inputs, dict):
            continue
        for section in ("required", "optional"):
            group = inputs.get(section)
            if not isinstance(group, dict):
                continue
            for name, s in group.items():
                if not isinstance(s, list) or not s:
                    continue
                opts = s[1] if len(s) > 1 and isinstance(s[1], dict) else {}
                if not (name in FILE_LOADERS.get(cls, ()) or any(opts.get(k) for k in ("image_upload", "video_upload", "audio_upload", "file_upload", "upload"))):
                    continue
                keep = lambda x: isinstance(x, str) and staged_name_ok(x[:-8] if x.endswith(" [input]") else x)  # noqa: E731
                if isinstance(s[0], list):
                    s[0] = [x for x in s[0] if keep(x)]
                if isinstance(opts.get("options"), list):
                    opts["options"] = [x for x in opts["options"] if keep(x)]
    return info


def make_middleware(trusted: Callable[[], Iterable[str]], cors_flag: str | None = None, studios: Studios | None = None, lan: bool = False):
    """`trusted`: the trusted origins now (read on each request, so a change applies at once).
    `cors_flag`: ComfyUI's --enable-cors-header value, when it was started with one.
    `studios`: what trusted studios did here (with the node list their prompts are checked against).
    `lan`: also serve a trusted studio when this ComfyUI is reached at a network address (FUOBE_CONNECT_LAN=1)."""
    flag = (cors_flag or "").strip()
    flag_origin = normalise(flag) if flag and flag != "*" else None
    guard_on = bool(flag) and flag != "*"
    if guard_on and flag_origin is None:
        logging.warning("[Fuobe Connect] --enable-cors-header %r isn't a website's address (like http://localhost:3000), so only ComfyUI's own page and the trusted studios get in.", flag[:80])
    studios = studios or Studios()

    @web.middleware
    async def fuobe_connect(request: web.Request, handler):
        raw = request.headers.get("Origin")
        if raw is not None:
            origin = normalise(raw)
            here = lan or is_loopback(host_name(request.headers.get("Host")))
            if origin and here and origin in set(trusted()):
                if request.method == "OPTIONS":
                    answer = preflight(request, origin)
                    if answer is not None:
                        return answer
                elif allowed(request.method, request.path, request.query_string):
                    headers = request.headers.copy()
                    headers.popall("Origin", None)
                    headers.popall("Sec-Fetch-Site", None)
                    headers[MARKER] = origin
                    # One clone, read here and handed on: ComfyUI's handler reads the same body.
                    clone = request.clone(headers=headers)
                    response = await studios.check(clone)
                    if response is None:
                        response = await studios.answer(clone, await _pass(clone, handler))
                    if isinstance(response, web.StreamResponse) and not response.prepared:
                        response.headers.update(_cors_headers(origin))
                    return response
                # A trusted site asking for anything else is any other website: ComfyUI decides (and turns it away).
            if guard_on and (origin is None or origin != flag_origin) and not same_host(raw, request.headers.get("Host")):
                if not (origin and origin in set(trusted())):
                    _note(raw[:120])
                return web.Response(status=403)
        elif guard_on and request.headers.get("Sec-Fetch-Site", "").lower() in ("cross-site", "same-site"):
            _note("another website")
            return web.Response(status=403)
        if MARKER in request.headers:
            headers = request.headers.copy()
            headers.popall(MARKER, None)
            request = request.clone(headers=headers)
        # Another website's request meets ComfyUI's own check first, the guard question too.
        if raw is not None and not same_host(raw, request.headers.get("Host")):
            return await handler(request)
        return await _pass(request, handler)

    fuobe_connect.studios = studios
    return fuobe_connect
