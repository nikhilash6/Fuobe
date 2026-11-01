"""Fuobe Connect's middleware in front of ComfyUI's own (tests/comfy_stack.py), over real HTTP on this computer.

Run: python -m unittest discover -s tests (from integrations/fuobe-connect). FUOBE_CONNECT_TEST_PORT picks the port
(3360 by default); COMFYUI_DIR=<a ComfyUI folder> reads ComfyUI's own middleware from it.
"""

from __future__ import annotations

import asyncio
import os
import sys
import unittest

import aiohttp
from aiohttp import web

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from comfy_stack import build_app  # noqa: E402
from fuobe_connect import plugin  # noqa: E402
from fuobe_connect.middleware import MARKER, make_middleware  # noqa: E402
from fuobe_connect.origins import allowed, normalise, parse_list, trusted_origins  # noqa: E402

PORT = int(os.environ.get("FUOBE_CONNECT_TEST_PORT", "3360"))
BASE = f"http://127.0.0.1:{PORT}"
FUOBE = "https://fuobe.com"
EVIL = "https://evil.example"


def browser(origin: str, site: str = "cross-site", **extra) -> dict:
    return {"Origin": origin, "Sec-Fetch-Site": site, "Sec-Fetch-Mode": "cors", **extra}


class Server:
    def __init__(self, app: web.Application):
        self.app = app

    async def __aenter__(self):
        self.runner = web.AppRunner(self.app)
        await self.runner.setup()
        await web.TCPSite(self.runner, "127.0.0.1", PORT).start()
        self.session = aiohttp.ClientSession()
        return self

    async def __aexit__(self, *exc):
        await self.session.close()
        await self.runner.cleanup()

    async def req(self, method: str, path: str, headers: dict | None = None, **kw):
        async with self.session.request(method, BASE + path, headers=headers or {}, **kw) as res:
            return res.status, dict(res.headers), await res.read()


class FakeStore:
    def __init__(self, data=None):
        self.data = data or {}

    def load(self):
        return dict(self.data)

    def update(self, **c):
        self.data.update({k: v for k, v in c.items() if v is not None})
        return self.data


def with_connect(trusted=trusted_origins(None, None), cors_flag=None):
    plugin._state.clear()
    plugin._state["store"] = FakeStore()
    routes = [("GET", "/fuobe/connect", plugin.status), ("POST", "/fuobe/connect/studios", plugin.set_studios)]
    app, source = build_app(cors_flag, make_middleware(lambda: trusted, cors_flag), routes)
    return app, source


def run(coro):
    return asyncio.run(coro)


class OriginsTest(unittest.TestCase):
    def test_normalise(self):
        self.assertEqual(normalise("https://Fuobe.com/"), "https://fuobe.com")
        self.assertEqual(normalise("https://fuobe.com:443"), "https://fuobe.com")
        self.assertEqual(normalise("http://localhost:3000"), "http://localhost:3000")
        for bad in ["fuobe.com", "https://fuobe.com/path", "javascript:alert(1)", "null", "", "https://user@fuobe.com", "ftp://fuobe.com"]:
            self.assertIsNone(normalise(bad), bad)

    def test_trusted(self):
        self.assertEqual(trusted_origins(None, None), ("https://fuobe.com", "https://www.fuobe.com"))
        self.assertEqual(trusted_origins("https://studio.example.com", ["https://fuobe.com"]), ("https://studio.example.com",))
        self.assertEqual(trusted_origins(None, "https://a.example, https://b.example:8443"), ("https://a.example", "https://b.example:8443"))
        self.assertEqual(parse_list("nonsense"), [])

    def test_allowed_paths(self):
        for m, p in [("GET", "/system_stats"), ("GET", "/api/system_stats"), ("POST", "/prompt"), ("POST", "/upload/image"), ("GET", "/ws"), ("GET", "/history/0f0e0d0c-0000-4000-8000-000000000000"), ("POST", "/api/jobs/0f0e0d0c-0000-4000-8000-000000000000/cancel"), ("GET", "/v2/customnode/installed")]:
            self.assertTrue(allowed(m, p), p)
        for m, p in [("GET", "/userdata/comfy.settings.json"), ("POST", "/v2/manager/queue/install"), ("POST", "/history"), ("POST", "/fuobe/connect/studios"), ("POST", "/fuobe/connect/pair"), ("DELETE", "/prompt"), ("GET", "/internal/logs")]:
            self.assertFalse(allowed(m, p), p)
        self.assertFalse(allowed("GET", "/view", "filename=a.png&type=input&subfolder="))
        self.assertTrue(allowed("GET", "/view", "filename=a.png&type=output&subfolder="))


class WithoutConnectTest(unittest.TestCase):
    """What a person sees today: ComfyUI turns the Fuobe page away."""

    def test_comfyui_refuses_the_studio(self):
        async def go():
            app, _ = build_app()
            async with Server(app) as s:
                status, _, _ = await s.req("GET", "/system_stats", browser(FUOBE))
                self.assertEqual(status, 403)

        run(go())


class DirectModeTest(unittest.TestCase):
    def test_studio_reads_and_queues(self):
        async def go():
            app, source = with_connect()
            print(f"\n  (middleware from {source})", end="")
            async with Server(app) as s:
                status, h, body = await s.req("GET", "/system_stats", browser(FUOBE))
                self.assertEqual(status, 200)
                self.assertEqual(h.get("Access-Control-Allow-Origin"), FUOBE)
                self.assertIn("Origin", h.get("Vary", ""))
                self.assertIn(b"comfyui_version", body)
                status, h, _ = await s.req("GET", "/api/system_stats", browser("https://www.fuobe.com"))
                self.assertEqual((status, h.get("Access-Control-Allow-Origin")), (200, "https://www.fuobe.com"))
                status, h, body = await s.req("POST", "/prompt", browser(FUOBE, **{"Content-Type": "application/json"}), data=b'{"prompt_id":"p1"}')
                self.assertEqual((status, h.get("Access-Control-Allow-Origin")), (200, FUOBE))
                self.assertIn(b"p1", body)
                status, h, _ = await s.req("GET", "/view?filename=a.png&subfolder=&type=output", browser(FUOBE))
                self.assertEqual(status, 200)

        run(go())

    def test_preflights(self):
        async def go():
            app, _ = with_connect()
            async with Server(app) as s:
                status, h, _ = await s.req(
                    "OPTIONS",
                    "/prompt",
                    browser(FUOBE, **{"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type", "Access-Control-Request-Private-Network": "true"}),
                )
                self.assertEqual(status, 204)
                self.assertEqual(h.get("Access-Control-Allow-Origin"), FUOBE)
                self.assertEqual(h.get("Access-Control-Allow-Private-Network"), "true")
                self.assertIn("POST", h.get("Access-Control-Allow-Methods", ""))
                self.assertEqual(h.get("Access-Control-Allow-Headers"), "content-type")
                self.assertNotIn("Access-Control-Allow-Credentials", h)
                # A simple GET that Chrome preflights only for Private Network Access.
                status, h, _ = await s.req("OPTIONS", "/system_stats", browser(FUOBE, **{"Access-Control-Request-Method": "GET", "Access-Control-Request-Private-Network": "true"}))
                self.assertEqual((status, h.get("Access-Control-Allow-Private-Network")), (204, "true"))
                # A header a run never sends: no preflight answer from Fuobe Connect, so ComfyUI's check refuses it.
                status, h, _ = await s.req("OPTIONS", "/prompt", browser(FUOBE, **{"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-custom"}))
                self.assertEqual(status, 403)
                self.assertNotIn("Access-Control-Allow-Origin", h)
                # Another website's preflight: refused by ComfyUI, as before.
                status, h, _ = await s.req("OPTIONS", "/prompt", browser(EVIL, **{"Access-Control-Request-Method": "POST", "Access-Control-Request-Private-Network": "true"}))
                self.assertEqual(status, 403)
                self.assertNotIn("Access-Control-Allow-Private-Network", h)

        run(go())

    def test_other_websites_stay_out(self):
        async def go():
            app, _ = with_connect()
            async with Server(app) as s:
                for origin in [EVIL, "https://fuobe.com.evil.example", "http://fuobe.com", "https://fuobe.com:444", "null"]:
                    for method, path in [("GET", "/system_stats"), ("POST", "/prompt")]:
                        status, h, _ = await s.req(method, path, browser(origin), data=b"{}" if method == "POST" else None)
                        self.assertEqual(status, 403, f"{origin} {method} {path}")
                        self.assertNotIn("Access-Control-Allow-Origin", h)
                # Without Sec-Fetch-Site (an older browser): ComfyUI's host check still refuses it.
                status, _, _ = await s.req("POST", "/prompt", {"Origin": EVIL}, data=b"{}")
                self.assertEqual(status, 403)

        run(go())

    def test_studio_reaches_only_what_a_run_needs(self):
        async def go():
            app, _ = with_connect()
            async with Server(app) as s:
                for method, path in [("GET", "/userdata/comfy.settings.json"), ("POST", "/v2/manager/queue/install"), ("POST", "/fuobe/connect/studios"), ("GET", "/view?filename=a.png&subfolder=&type=input")]:
                    status, h, _ = await s.req(method, path, browser(FUOBE, **{"Content-Type": "application/json"}), data=b'{"studios":"https://evil.example"}' if method == "POST" else None)
                    self.assertEqual(status, 403, path)
                    self.assertNotIn("Access-Control-Allow-Origin", h)
                status, h, _ = await s.req("OPTIONS", "/v2/manager/queue/install", browser(FUOBE, **{"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"}))
                self.assertEqual(status, 403)
                self.assertNotIn("Access-Control-Allow-Origin", h)

        run(go())

    def test_comfyui_page_and_programs_unchanged(self):
        async def go():
            app, _ = with_connect()
            async with Server(app) as s:
                status, h, _ = await s.req("POST", "/prompt", {"Origin": BASE, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json"}, data=b"{}")
                self.assertEqual(status, 200)
                self.assertNotIn("Access-Control-Allow-Origin", h)
                status, _, _ = await s.req("GET", "/userdata/x")
                self.assertEqual(status, 200)

        run(go())

    def test_websocket(self):
        async def go():
            app, _ = with_connect()
            async with Server(app) as s:
                async with s.session.ws_connect(f"ws://127.0.0.1:{PORT}/ws?clientId=abc12345", headers=browser(FUOBE, **{"Sec-Fetch-Mode": "websocket"})) as ws:
                    msg = await ws.receive(timeout=5)
                    self.assertIn("status", msg.data)
                with self.assertRaises(aiohttp.WSServerHandshakeError) as e:
                    async with s.session.ws_connect(f"ws://127.0.0.1:{PORT}/ws?clientId=abc12345", headers=browser(EVIL, **{"Sec-Fetch-Mode": "websocket"})):
                        pass
                self.assertEqual(e.exception.status, 403)

        run(go())

    def test_status_says_less_to_a_studio(self):
        async def go():
            app, _ = with_connect()
            async with Server(app) as s:
                status, h, body = await s.req("GET", "/fuobe/connect", browser(FUOBE))
                self.assertEqual((status, h.get("Access-Control-Allow-Origin")), (200, FUOBE))
                self.assertNotIn(b"studios", body)
                self.assertIn(b'"connect": 1', body)
                status, _, body = await s.req("GET", "/fuobe/connect")
                self.assertIn(b"studios", body)
                # A program can't pass itself off as a studio to get less, or more: the marker is dropped on the way in.
                status, _, body = await s.req("GET", "/fuobe/connect", {MARKER: FUOBE})
                self.assertIn(b"studios", body)
                # Only ComfyUI's own page changes the studios.
                status, _, _ = await s.req("POST", "/fuobe/connect/studios", {"Origin": BASE, "Content-Type": "application/json"}, data=b'{"studios":"https://studio.example.com"}')
                self.assertEqual(status, 200)

        run(go())


class WithCorsFlagTest(unittest.TestCase):
    """ComfyUI started with --enable-cors-header: its own check is off, so Fuobe Connect does what Fuobe's guard did."""

    def test_guard(self):
        async def go():
            app, _ = with_connect(cors_flag="https://other-studio.example")
            async with Server(app) as s:
                status, h, _ = await s.req("GET", "/system_stats", browser(FUOBE))
                self.assertEqual((status, h.get("Access-Control-Allow-Origin")), (200, FUOBE))
                status, _, _ = await s.req("POST", "/prompt", browser(EVIL), data=b"{}")
                self.assertEqual(status, 403)
                status, _, _ = await s.req("POST", "/prompt", browser("https://other-studio.example"), data=b"{}")
                self.assertEqual(status, 200)
                status, _, _ = await s.req("POST", "/v2/manager/queue/install", browser(FUOBE), data=b"{}")
                self.assertEqual(status, 403)
                status, _, _ = await s.req("POST", "/prompt", {"Sec-Fetch-Site": "cross-site"}, data=b"{}")
                self.assertEqual(status, 403)

        run(go())

    def test_star_adds_no_check(self):
        async def go():
            app, _ = with_connect(cors_flag="*")
            async with Server(app) as s:
                status, _, _ = await s.req("POST", "/prompt", browser(EVIL), data=b"{}")
                self.assertEqual(status, 200)

        run(go())


if __name__ == "__main__":
    unittest.main()
