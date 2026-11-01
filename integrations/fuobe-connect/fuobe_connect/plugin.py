"""Fuobe Connect inside ComfyUI: the middleware, its own small API for ComfyUI's page, and the pairing agent.

ComfyUI loads custom nodes after it made its web app and before it starts serving, so the middleware can still be put
in front of ComfyUI's own (once ComfyUI serves, the list is frozen and nothing can be added). Nothing in ComfyUI's own
files changes.
"""

from __future__ import annotations

import logging
import os

from aiohttp import web

from . import __version__
from .middleware import make_middleware, MARKER
from .origins import normalise, parse_list, same_host, trusted_origins

log = logging.getLogger("fuobe_connect")

_state: dict = {}


def trusted() -> tuple[str, ...]:
    store = _state.get("store")
    configured = store.load().get("studios") if store else None
    return trusted_origins(os.environ.get("FUOBE_CONNECT_ORIGINS"), configured)


def _own_page(request: web.Request) -> bool:
    """A call from ComfyUI's own page, or from a program on this computer: never from a trusted studio or any website."""
    if request.headers.get(MARKER):
        return False
    origin = request.headers.get("Origin")
    return origin is None or same_host(origin, request.headers.get("Host"))


async def status(request: web.Request) -> web.Response:
    """GET /fuobe/connect. A studio sees only that Fuobe Connect is here; ComfyUI's own page sees the rest."""
    base = {"connect": 1, "version": __version__, "guard": 1}
    if not _own_page(request):
        return web.json_response(base)
    agent = _state.get("agent")
    return web.json_response({**base, "studios": list(trusted()), "fromEnv": bool(os.environ.get("FUOBE_CONNECT_ORIGINS")), **(agent.status() if agent else {"state": "off"})})


async def set_studios(request: web.Request) -> web.Response:
    """POST /fuobe/connect/studios {studios: "https://a, https://b"}: the studios that may use this ComfyUI."""
    if not _own_page(request):
        return web.Response(status=403)
    body = await request.json()
    studios = parse_list(body.get("studios") if isinstance(body, dict) else None)
    if not studios:
        return web.json_response({"error": "Name at least one studio, like https://fuobe.com"}, status=400)
    _state["store"].update(studios=studios)
    return web.json_response({"studios": list(trusted())})


async def pair(request: web.Request) -> web.Response:
    """POST /fuobe/connect/pair {site?}: a code to approve on the studio."""
    if not _own_page(request):
        return web.Response(status=403)
    agent = _state.get("agent")
    try:
        body = await request.json()
    except ValueError:
        body = {}
    site = normalise((body or {}).get("site")) if isinstance(body, dict) else None
    try:
        fut = agent.call(agent.start_pairing(site or trusted()[0]))
        import asyncio

        return web.json_response(await asyncio.wrap_future(fut))
    except Exception as e:
        return web.json_response({"error": str(e)}, status=502)


async def unpair(request: web.Request) -> web.Response:
    if not _own_page(request):
        return web.Response(status=403)
    import asyncio

    agent = _state["agent"]
    agent.cancel_pairing()
    return web.json_response(await asyncio.wrap_future(agent.call(agent.unpair())))


def install():
    """Called once when ComfyUI loads this custom node."""
    import folder_paths
    import server
    from comfy.cli_args import args

    from .agent import Agent
    from .net import loopback_base
    from .store import Store

    instance = getattr(server.PromptServer, "instance", None)
    if instance is None:
        log.warning("[Fuobe Connect] ComfyUI's server isn't there, so Fuobe Connect is off.")
        return
    app = instance.app
    if any(getattr(m, "__name__", "") == "fuobe_connect" for m in app.middlewares):
        return
    store = Store(folder_paths.get_user_directory())
    _state["store"] = store
    try:
        app.middlewares.insert(0, make_middleware(trusted, getattr(args, "enable_cors_header", None)))
    except RuntimeError:
        log.warning("[Fuobe Connect] ComfyUI had already started, so Fuobe Connect is off. Restart ComfyUI.")
        return
    instance.routes.get("/fuobe/connect")(status)
    instance.routes.post("/fuobe/connect/studios")(set_studios)
    instance.routes.post("/fuobe/connect/pair")(pair)
    instance.routes.post("/fuobe/connect/unpair")(unpair)

    port = int(getattr(args, "port", 8188) or 8188)
    agent = Agent(store, loopback_base(getattr(args, "listen", None), port, bool(getattr(args, "tls_keyfile", None))), port, trusted()[0])
    _state["agent"] = agent
    agent.start()
    log.info("[Fuobe Connect] %s can use this ComfyUI from the browser.", ", ".join(trusted()))
    if os.environ.get("FUOBE_CONNECT_PAIR") == "1" and not store.load().get("token"):
        # A PC with no screen: the code and the address go to ComfyUI's console.
        agent.call(agent.start_pairing(os.environ.get("FUOBE_CONNECT_SITE") or trusted()[0]))
    elif not store.load().get("token"):
        log.info("[Fuobe Connect] To run Fuobe jobs here with no browser tab open: ComfyUI menu → Extensions → Connect to Fuobe.")
