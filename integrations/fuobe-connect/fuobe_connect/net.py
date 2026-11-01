"""The two places Fuobe Connect talks to: the paired Fuobe studio (over HTTPS, with its token) and this ComfyUI itself
(on this computer, as a program: no browser headers, so ComfyUI's own checks treat it as it treats any local tool).

Only aiohttp, which ComfyUI already has.
"""

from __future__ import annotations

import json
import ssl
from dataclasses import dataclass
from urllib.parse import urlencode, urlsplit

import aiohttp

from . import __version__

USER_AGENT = f"FuobeConnect/{__version__}"


class SiteError(Exception):
    def __init__(self, status: int, message: str = "", body: dict | None = None):
        super().__init__(message or f"HTTP {status}")
        self.status = status
        self.body = body or {}


@dataclass
class Answer:
    status: int
    body: dict
    headers: dict


def site_base(site: str) -> str:
    u = urlsplit(site.strip())
    if u.scheme not in ("https", "http") or not u.hostname:
        raise ValueError("The studio's address must start with https://")
    return f"{u.scheme}://{u.netloc}"


class Site:
    """The Fuobe studio. Every call says who is calling (FuobeConnect/<version>); job calls carry the worker token."""

    def __init__(self, session: aiohttp.ClientSession, site: str, token: str | None = None):
        self.session = session
        self.base = site_base(site)
        self.token = token

    def _headers(self, extra: dict | None = None) -> dict:
        h = {"User-Agent": USER_AGENT}
        if self.token:
            h["Authorization"] = f"Bearer {self.token}"
        if extra:
            h.update(extra)
        return h

    async def call(self, method: str, path: str, body=None, headers: dict | None = None, data: bytes | None = None, timeout: float = 60) -> Answer:
        kwargs = {"headers": self._headers(headers), "timeout": aiohttp.ClientTimeout(total=timeout)}
        if body is not None:
            kwargs["data"] = json.dumps(body)
            kwargs["headers"]["Content-Type"] = "application/json"
        elif data is not None:
            kwargs["data"] = data
        async with self.session.request(method, self.base + path, **kwargs) as res:
            text = await res.text()
            try:
                parsed = json.loads(text) if text else {}
            except ValueError:
                parsed = {}
            return Answer(res.status, parsed if isinstance(parsed, dict) else {}, dict(res.headers))

    async def read(self, path: str, headers: dict | None = None) -> tuple[int, bytes, dict]:
        async with self.session.get(self.base + path, headers=self._headers(headers), timeout=aiohttp.ClientTimeout(total=600)) as res:
            return res.status, await res.read(), dict(res.headers)

    # Pairing (no token yet).
    async def pair_start(self, name: str, facts: dict) -> Answer:
        return await self.call("POST", "/api/gpu/pair/start", {"name": name, "facts": facts}, timeout=20)

    async def pair_poll(self, pair_id: str, secret: str) -> Answer:
        return await self.call("POST", "/api/gpu/pair/poll", {"id": pair_id, "secret": secret}, timeout=20)


class Comfy:
    """This ComfyUI, from inside it: only the calls a run needs, to its own address."""

    def __init__(self, session: aiohttp.ClientSession, base: str):
        self.session = session
        self.base = base.rstrip("/")
        self._ssl = False if base.startswith("https://") else None

    def _kw(self, timeout: float = 30) -> dict:
        kw = {"timeout": aiohttp.ClientTimeout(total=timeout)}
        if self._ssl is False:
            kw["ssl"] = False
        return kw

    async def get_json(self, path: str, timeout: float = 30):
        async with self.session.get(self.base + path, **self._kw(timeout)) as res:
            if res.status != 200:
                raise SiteError(res.status, f"ComfyUI {path.split('?')[0]} answered HTTP {res.status}")
            return await res.json(content_type=None)

    async def get_status(self, path: str) -> tuple[int, object]:
        async with self.session.get(self.base + path, **self._kw()) as res:
            body = await res.json(content_type=None) if res.status == 200 else None
            return res.status, body

    async def post_json(self, path: str, body: dict, timeout: float = 60) -> tuple[int, dict]:
        async with self.session.post(self.base + path, data=json.dumps(body), headers={"Content-Type": "application/json"}, **self._kw(timeout)) as res:
            text = await res.text()
            try:
                parsed = json.loads(text) if text else {}
            except ValueError:
                parsed = {}
            return res.status, parsed if isinstance(parsed, dict) else {}

    async def upload_input(self, name: str, data: bytes, content_type: str) -> int:
        form = aiohttp.FormData()
        form.add_field("image", data, filename=name, content_type=content_type or "application/octet-stream")
        form.add_field("type", "input")
        form.add_field("overwrite", "true")
        async with self.session.post(self.base + "/upload/image", data=form, **self._kw(600)) as res:
            await res.read()
            return res.status

    async def view(self, filename: str, subfolder: str, kind: str) -> bytes | None:
        q = urlencode({"filename": filename, "subfolder": subfolder, "type": kind})
        async with self.session.get(f"{self.base}/view?{q}", **self._kw(600)) as res:
            return await res.read() if res.status == 200 else None

    def ws_url(self, client_id: str) -> str:
        return self.base.replace("http", "ws", 1) + "/ws?" + urlencode({"clientId": client_id})


def loopback_base(listen: str | None, port: int, tls: bool) -> str:
    """Where this ComfyUI answers on this computer, from its --listen and --port."""
    hosts = [h.strip() for h in (listen or "127.0.0.1").split(",") if h.strip()]
    pick = "127.0.0.1"
    for h in hosts:
        if h in ("127.0.0.1", "localhost"):
            pick = "127.0.0.1"
            break
        if h == "::1":
            pick = "[::1]"
            break
    else:
        if hosts and hosts[0] not in ("0.0.0.0", "::", ""):
            pick = f"[{hosts[0]}]" if ":" in hosts[0] else hosts[0]
    return f"{'https' if tls else 'http'}://{pick}:{int(port)}"


def ssl_context() -> ssl.SSLContext:
    return ssl.create_default_context()
