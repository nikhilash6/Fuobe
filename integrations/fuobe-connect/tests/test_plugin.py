"""Fuobe Connect as ComfyUI loads it: __init__.py run against a stand-in of ComfyUI's server module (its PromptServer
with ComfyUI's own middleware, tests/comfy_stack.py), then pairing through ComfyUI's page with a stand-in studio.

Ports: FUOBE_CONNECT_TEST_PORT + 5 for the ComfyUI stand-in, + 6 for the studio stand-in (3365 and 3366 by default).
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import time
import types
import unittest

import aiohttp
from aiohttp import web

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from comfy_stack import build_app  # noqa: E402

BASE_PORT = int(os.environ.get("FUOBE_CONNECT_TEST_PORT", "3360"))
COMFY_PORT = BASE_PORT + 5
SITE_PORT = BASE_PORT + 6
SITE = f"http://127.0.0.1:{SITE_PORT}"


class FakeStudio:
    """Answers the pairing and worker calls the way a Fuobe studio does, with fixed values."""

    def __init__(self):
        self.polls = 0
        self.calls: list[str] = []
        self.app = web.Application()
        self.app.router.add_post("/api/gpu/pair/start", self.start)
        self.app.router.add_post("/api/gpu/pair/poll", self.poll)
        self.app.router.add_post("/api/gpu/computer/beat", self.beat)
        self.app.router.add_post("/api/gpu/computer/claim", self.claim)
        self.app.router.add_post("/api/gpu/computer/unpair", self.unpair)

    async def start(self, request):
        self.calls.append("start")
        body = await request.json()
        self.name = body.get("name")
        return web.json_response({"id": "pair-1", "secret": "s" * 64, "code": "ABCD-EFGH", "url": f"{SITE}/connect?code=ABCD-EFGH", "expiresAt": 0, "pollMs": 1000})

    async def poll(self, request):
        self.polls += 1
        if self.polls < 2:
            return web.json_response({"state": "waiting"})
        return web.json_response({"state": "approved", "token": "fuobe_wkr_" + "T" * 43, "workerId": "w1", "name": self.name})

    async def beat(self, request):
        self.calls.append(f"beat:{request.headers.get('Authorization', '')[:20]}")
        return web.json_response({"runner": False, "heldElsewhere": True, "waiting": 0, "stops": []})

    async def claim(self, request):
        return web.Response(status=204)

    async def unpair(self, request):
        self.calls.append("unpair")
        return web.json_response({"ok": True})


def load_pack(user_dir: str):
    """ComfyUI's view of the world, as much of it as Fuobe Connect reads, then the pack itself."""
    app, _ = build_app()
    instance = types.SimpleNamespace(app=app, routes=web.RouteTableDef())
    server = types.ModuleType("server")
    server.PromptServer = types.SimpleNamespace(instance=instance)
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_user_directory = lambda: user_dir
    cli_args = types.ModuleType("comfy.cli_args")
    cli_args.args = types.SimpleNamespace(port=COMFY_PORT, listen="127.0.0.1", enable_cors_header=None, tls_keyfile=None)
    comfy = types.ModuleType("comfy")
    comfy.cli_args = cli_args
    sys.modules.update({"server": server, "folder_paths": folder_paths, "comfy": comfy, "comfy.cli_args": cli_args})
    os.environ["FUOBE_CONNECT_ORIGINS"] = SITE
    spec = importlib.util.spec_from_file_location("fuobe_connect_pack", os.path.join(PACK, "__init__.py"), submodule_search_locations=[PACK])
    module = importlib.util.module_from_spec(spec)
    sys.modules["fuobe_connect_pack"] = module
    spec.loader.exec_module(module)
    return module, instance


class PluginTest(unittest.TestCase):
    def test_loads_into_comfyui_and_pairs(self):
        user_dir = tempfile.mkdtemp(prefix="fuobe-connect-user-")
        module, instance = load_pack(user_dir)
        self.assertEqual(module.NODE_CLASS_MAPPINGS, {})
        self.assertEqual(module.WEB_DIRECTORY, "./web")
        self.assertEqual(getattr(instance.app.middlewares[0], "__name__", ""), "fuobe_connect")
        paths = {(r.method, r.path) for r in instance.routes}
        self.assertIn(("GET", "/fuobe/connect"), paths)
        self.assertIn(("POST", "/fuobe/connect/pair"), paths)
        instance.app.add_routes(instance.routes)
        studio = FakeStudio()

        async def go():
            runners = []
            for app, port in ((instance.app, COMFY_PORT), (studio.app, SITE_PORT)):
                r = web.AppRunner(app)
                await r.setup()
                await web.TCPSite(r, "127.0.0.1", port).start()
                runners.append(r)
            try:
                async with aiohttp.ClientSession() as s:
                    base = f"http://127.0.0.1:{COMFY_PORT}"
                    async with s.get(f"{base}/fuobe/connect") as res:
                        st = await res.json()
                    self.assertEqual(st["studios"], [SITE])
                    self.assertEqual(st["state"], "unpaired")
                    # The studio itself can't start a pairing, or change the studios.
                    async with s.post(f"{base}/fuobe/connect/pair", json={}, headers={"Origin": SITE, "Sec-Fetch-Site": "cross-site"}) as res:
                        self.assertEqual(res.status, 403)
                    # ComfyUI's own page can.
                    async with s.post(f"{base}/fuobe/connect/pair", json={}, headers={"Origin": base}) as res:
                        body = await res.json()
                    self.assertEqual(res.status, 200, body)
                    self.assertEqual(body["pairing"]["code"], "ABCD-EFGH")
                    deadline = time.time() + 15
                    while time.time() < deadline:
                        async with s.get(f"{base}/fuobe/connect") as res:
                            st = await res.json()
                        if st.get("paired") and any(c.startswith("beat:Bearer fuobe_wkr_") for c in studio.calls):
                            break
                        await asyncio.sleep(0.3)
                    self.assertEqual(st["paired"]["site"], SITE)
                    self.assertTrue(any(c.startswith("beat:Bearer fuobe_wkr_") for c in studio.calls), studio.calls)
                    with open(os.path.join(user_dir, "fuobe-connect.json"), encoding="utf-8") as f:
                        saved = json.load(f)
                    self.assertTrue(saved["token"].startswith("fuobe_wkr_"))
                    if os.name != "nt":
                        self.assertEqual(os.stat(os.path.join(user_dir, "fuobe-connect.json")).st_mode & 0o777, 0o600)
                    async with s.post(f"{base}/fuobe/connect/unpair", json={}, headers={"Origin": base}) as res:
                        st = await res.json()
                    self.assertNotIn("paired", st)
                    self.assertIn("unpair", studio.calls)
                    with open(os.path.join(user_dir, "fuobe-connect.json"), encoding="utf-8") as f:
                        self.assertNotIn("token", json.load(f))
            finally:
                for r in runners:
                    await r.cleanup()

        asyncio.run(go())


if __name__ == "__main__":
    unittest.main()
