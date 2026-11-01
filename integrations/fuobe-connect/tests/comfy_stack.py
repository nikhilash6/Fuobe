"""A stand-in ComfyUI web app for the tests, with ComfyUI's own middleware.

With COMFYUI_DIR set to a ComfyUI folder, the middleware functions are read from that ComfyUI's own server.py and
middleware/cache_middleware.py (only those functions: nothing else of ComfyUI is imported, so no models, no GPU and no
torch are needed). Without it, a copy of ComfyUI 0.42's origin check is used. Either way the app is built the way
ComfyUI's PromptServer builds it: [cache_control, deprecation_warning] then the CORS middleware when started with
--enable-cors-header, else the origin check. Fuobe Connect then goes in front, as in ComfyUI.

The routes answer like ComfyUI's, with fixed values: enough to see who gets in.
"""

from __future__ import annotations

import ast
import ipaddress
import json
import logging
import os
import socket
import urllib
import urllib.parse

from aiohttp import web

WANTED = {"create_cors_middleware", "is_loopback", "create_origin_only_middleware", "deprecation_warning"}


def _from_comfyui(folder: str) -> dict:
    ns: dict = {"web": web, "urllib": urllib, "ipaddress": ipaddress, "socket": socket, "logging": logging, "_deprecated_paths_warned": set()}
    with open(os.path.join(folder, "server.py"), encoding="utf-8") as f:
        tree = ast.parse(f.read())
    picked = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in WANTED]
    missing = WANTED - {n.name for n in picked}
    if missing:
        raise RuntimeError(f"ComfyUI's server.py has no {', '.join(sorted(missing))}")
    exec(compile(ast.Module(body=picked, type_ignores=[]), "comfyui/server.py", "exec"), ns)
    with open(os.path.join(folder, "middleware", "cache_middleware.py"), encoding="utf-8") as f:
        exec(compile(f.read(), "comfyui/middleware/cache_middleware.py", "exec"), ns)
    ns["source"] = f"ComfyUI at {folder}"
    return ns


def _copy() -> dict:
    """ComfyUI 0.42's origin check and CORS middleware, as they are in its server.py."""

    def create_cors_middleware(allowed_origin):
        @web.middleware
        async def cors_middleware(request, handler):
            response = web.Response() if request.method == "OPTIONS" else await handler(request)
            response.headers["Access-Control-Allow-Origin"] = allowed_origin
            response.headers["Access-Control-Allow-Methods"] = "POST, GET, DELETE, PUT, OPTIONS, PATCH"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            response.headers["Access-Control-Allow-Credentials"] = "true"
            return response

        return cors_middleware

    def is_loopback(host):
        if host is None:
            return False
        try:
            return ipaddress.ip_address(host).is_loopback
        except ValueError:
            pass
        return host == "localhost"

    def create_origin_only_middleware():
        @web.middleware
        async def origin_only_middleware(request, handler):
            if request.headers.get("Sec-Fetch-Site") == "cross-site":
                return web.Response(status=403)
            if "Host" in request.headers and "Origin" in request.headers:
                host_domain = request.headers["Host"].lower()
                parsed = urllib.parse.urlparse(request.headers["Origin"])
                origin_domain = parsed.netloc.lower()
                host_parsed = urllib.parse.urlsplit("//" + host_domain)
                loopback = is_loopback(host_parsed.hostname)
                if parsed.port is None:
                    host_domain = host_parsed.hostname
                if host_parsed.port is None:
                    origin_domain = parsed.hostname
                if loopback and host_domain and origin_domain and host_domain != origin_domain:
                    return web.Response(status=403)
            return web.Response() if request.method == "OPTIONS" else await handler(request)

        return origin_only_middleware

    @web.middleware
    async def deprecation_warning(request, handler):
        return await handler(request)

    @web.middleware
    async def cache_control(request, handler):
        return await handler(request)

    return {
        "create_cors_middleware": create_cors_middleware,
        "create_origin_only_middleware": create_origin_only_middleware,
        "deprecation_warning": deprecation_warning,
        "cache_control": cache_control,
        "source": "a copy of ComfyUI 0.42's checks",
    }


def comfy_middleware() -> dict:
    folder = os.environ.get("COMFYUI_DIR")
    return _from_comfyui(folder) if folder else _copy()


def build_app(cors_flag: str | None = None, fuobe_connect=None, extra_routes=None) -> tuple[web.Application, str]:
    ns = comfy_middleware()
    middlewares = [ns["cache_control"], ns["deprecation_warning"]]
    middlewares.append(ns["create_cors_middleware"](cors_flag) if cors_flag else ns["create_origin_only_middleware"]())
    app = web.Application(middlewares=middlewares)
    routes = web.RouteTableDef()

    @routes.get("/system_stats")
    async def stats(request):
        return web.json_response({"system": {"os": "nt", "comfyui_version": "0.42.0", "ram_total": 1}, "devices": [{"name": "cuda:0 Test GPU", "vram_total": 2}]})

    @routes.post("/prompt")
    async def prompt(request):
        body = await request.json()
        return web.json_response({"prompt_id": body.get("prompt_id"), "number": 1})

    @routes.get("/view")
    async def view(request):
        return web.Response(body=b"\x89PNG\r\n\x1a\nfake", content_type="image/png")

    @routes.get("/userdata/{file}")
    async def userdata(request):
        return web.json_response({"secret": "settings"})

    @routes.post("/v2/manager/queue/install")
    async def install(request):
        return web.json_response({"installed": True})

    @routes.get("/ws")
    async def ws(request):
        sock = web.WebSocketResponse()
        await sock.prepare(request)
        await sock.send_str(json.dumps({"type": "status", "data": {"sid": "x"}}))
        await sock.close()
        return sock

    for method, path, handler in extra_routes or []:
        routes.route(method, path)(handler)

    # ComfyUI answers every route under /api too.
    api = web.RouteTableDef()
    for r in routes:
        api.route(r.method, "/api" + r.path)(r.handler)
    app.add_routes(api)
    app.add_routes(routes)
    if fuobe_connect is not None:
        app.middlewares.insert(0, fuobe_connect)
    return app, ns["source"]
