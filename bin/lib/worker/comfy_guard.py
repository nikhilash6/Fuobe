"""The guard of a Fuobe worker's own ComfyUI (docs/gpu-workers.md).

The worker starts its ComfyUI through this file instead of main.py:

    python comfy_guard.py <ComfyUI>/main.py --listen 127.0.0.1 --port <port> ...

It reads the key the worker made for this start (FUOBE_WORKER_GUARD_KEY, then removes it from the environment), puts
a check in front of every aiohttp application ComfyUI makes, and runs main.py as ComfyUI's own start does. The check
answers 403 to any request whose Host is not exactly 127.0.0.1:<port>, or that does not carry the key in
X-Fuobe-Worker-Key. A web page that points its own name at 127.0.0.1 (DNS rebinding) sends neither, so it reaches
nothing.

Some routes answer 403 to every request, with the key or without (BLOCKED_ROUTES): routes a node pack can add that the
worker never uses, refused under ComfyUI's /api prefix too.

One request needs no key: GET /fuobe-worker/hello with X-Fuobe-Worker-Challenge (16 to 128 hex digits). The answer is
the challenge signed with the key (HMAC-SHA-256), this process's id and its parent's (a venv's python.exe on Windows
starts the real Python as a child of its own). The worker checks both before it sends the key, so a program that took
the port first never learns it.

The worker starts this file in Python's isolated mode (-I), so its own folder is never on the import path. That mode
also ignores PYTHONIOENCODING, which this file applies to its output itself.

Only the Python standard library and aiohttp (which ComfyUI needs anyway).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import runpy
import sys
from urllib.parse import unquote

KEY_ENV = "FUOBE_WORKER_GUARD_KEY"
KEY_HEADER = "X-Fuobe-Worker-Key"
CHALLENGE_HEADER = "X-Fuobe-Worker-Challenge"
HELLO_PATH = "/fuobe-worker/hello"
CHALLENGE = re.compile(r"^[0-9a-f]{16,128}$")
# Routes no request reaches. ComfyUI-InstantHMR's live capture (/instanthmr/*: a websocket with no login that writes
# recordings and can send UDP) is left out of the pack the worker installs; this refuses it again if a full copy loads.
BLOCKED_ROUTES = ("/instanthmr",)


def blocked(path: str) -> bool:
    """The path is a blocked route or under one, also under /api (ComfyUI serves every route there too), in any case
    and with any doubled slash or "." step."""
    p = "/" + "/".join(s for s in unquote(path.split("?", 1)[0]).replace("\\", "/").split("/") if s not in ("", ".")).lower()
    return any(p == b or p.startswith(b + "/") for r in BLOCKED_ROUTES for b in (r, "/api" + r))


def _bytes(text: str) -> bytes:
    return text.encode("utf-8", "surrogateescape")


def proof(key: str, challenge: str) -> str:
    """The challenge signed with the key."""
    return hmac.new(_bytes(key), _bytes(challenge), hashlib.sha256).hexdigest()


def allowed(headers, key: str, host: str) -> bool:
    """The request names this ComfyUI exactly and carries the key."""
    return headers.get("Host", "") == host and hmac.compare_digest(_bytes(headers.get(KEY_HEADER, "")), _bytes(key))


def make_middleware(web, key: str, host: str):
    """The check, as an aiohttp middleware."""

    @web.middleware
    async def fuobe_worker_guard(request, handler):
        if request.headers.get("Host", "") != host:
            return web.Response(status=403)
        if blocked(request.path) or blocked(request.raw_path):
            return web.Response(status=403)
        if request.method == "GET" and request.path == HELLO_PATH and KEY_HEADER not in request.headers:
            challenge = request.headers.get(CHALLENGE_HEADER, "")
            if not CHALLENGE.match(challenge):
                return web.Response(status=403)
            return web.json_response({"proof": proof(key, challenge), "pid": os.getpid(), "ppid": os.getppid()})
        if not allowed(request.headers, key, host):
            return web.Response(status=403)
        return await handler(request)

    return fuobe_worker_guard


def install(web, key: str, host: str) -> None:
    """Every aiohttp application made from now on gets the check first (ComfyUI's server, and its sub-applications)."""
    original = web.Application.__init__
    guard = make_middleware(web, key, host)

    def guarded_init(self, *args, middlewares=(), **kwargs):
        original(self, *args, middlewares=[guard, *list(middlewares)], **kwargs)

    web.Application.__init__ = guarded_init


def port_of(args: list[str]) -> int:
    """The --port ComfyUI is started with."""
    for i, a in enumerate(args):
        if a == "--port" and i + 1 < len(args):
            return int(args[i + 1])
        if a.startswith("--port="):
            return int(a.split("=", 1)[1])
    raise SystemExit("The worker's guard needs --port")


def output_encoding(env) -> None:
    """PYTHONIOENCODING ("encoding[:errors]") for this process's output, as Python applies it outside isolated mode."""
    value = env.get("PYTHONIOENCODING", "")
    if not value or not sys.flags.ignore_environment:
        return
    encoding, _, errors = value.partition(":")
    options = {k: v for k, v in (("encoding", encoding), ("errors", errors)) if v}
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(**options)
        except (AttributeError, LookupError, ValueError):
            pass


def main(argv: list[str]) -> None:
    output_encoding(os.environ)
    key = os.environ.pop(KEY_ENV, "")
    if len(key) < 32:
        raise SystemExit("The worker's guard has no key: start ComfyUI from the worker")
    if len(argv) < 2:
        raise SystemExit("Usage: comfy_guard.py <ComfyUI>/main.py [ComfyUI's arguments]")
    main_py = os.path.abspath(argv[1])
    args = argv[2:]
    host = f"127.0.0.1:{port_of(args)}"
    comfy_dir = os.path.dirname(main_py)
    # Imports come from ComfyUI's folder, never from this file's folder (the worker's own).
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path[:] = [p for p in sys.path if os.path.abspath(p or os.curdir) != here]
    sys.path.insert(0, comfy_dir)
    from aiohttp import web

    install(web, key, host)
    sys.argv = [main_py, *args]
    runpy.run_path(main_py, run_name="__main__")


if __name__ == "__main__":
    main(sys.argv)
