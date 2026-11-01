"""The middleware that lets a trusted Fuobe studio use this ComfyUI from the browser, with no start flag.

ComfyUI turns away every request from another website (its origin check). This middleware runs before that check and
handles exactly one case: a request from a trusted studio (an exact origin) for a path a Fuobe run needs
(origins.allowed). For that request it:

- answers the browser's CORS preflight, and Chrome's Private Network Access preflight, for that origin only;
- passes the request on without its Origin and Sec-Fetch-Site headers, so ComfyUI's own check sees what it sees for a
  program on this computer, and adds Access-Control-Allow-Origin for that origin to the answer.

Every other request goes on untouched, so ComfyUI's own check still turns away every other website.

When ComfyUI was started with --enable-cors-header (which switches its own check off), the middleware also does what
Fuobe's guard does: a request from a web page gets in only when the page is ComfyUI's own, the origin the setting
names, or a trusted studio. With "--enable-cors-header *" (every site, the person's choice) it adds no check.

Pure aiohttp: the tests load it with ComfyUI's own middleware and nothing else.
"""

from __future__ import annotations

import logging
from typing import Callable, Iterable

from aiohttp import web

from .origins import allowed, normalise, same_host

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


def make_middleware(trusted: Callable[[], Iterable[str]], cors_flag: str | None = None):
    """`trusted`: the trusted origins now (read on each request, so a change applies at once).
    `cors_flag`: ComfyUI's --enable-cors-header value, when it was started with one."""
    flag = (cors_flag or "").strip()
    flag_origin = normalise(flag) if flag and flag != "*" else None
    guard_on = bool(flag) and flag != "*"

    @web.middleware
    async def fuobe_connect(request: web.Request, handler):
        raw = request.headers.get("Origin")
        if raw is not None:
            origin = normalise(raw)
            if origin and origin in set(trusted()):
                if request.method == "OPTIONS":
                    answer = preflight(request, origin)
                    if answer is not None:
                        return answer
                elif allowed(request.method, request.path, request.query_string):
                    headers = request.headers.copy()
                    headers.popall("Origin", None)
                    headers.popall("Sec-Fetch-Site", None)
                    headers[MARKER] = origin
                    response = await _pass(request.clone(headers=headers), handler)
                    if isinstance(response, web.StreamResponse) and not response.prepared:
                        response.headers.update(_cors_headers(origin))
                    return response
                # A trusted site asking for anything else is any other website: ComfyUI decides (and turns it away).
            if guard_on and origin != flag_origin and not same_host(raw, request.headers.get("Host")):
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

    return fuobe_connect
