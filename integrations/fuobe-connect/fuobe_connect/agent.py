"""Pairing mode: Fuobe Connect runs your Fuobe jobs on this ComfyUI with no browser tab, after one approval.

For browsers that can't reach this computer from a website (Safari, Firefox in some setups, phones) and for PCs with no
screen. It runs in its own thread with its own event loop, so ComfyUI's own work is never held up by it.

1. "Connect to Fuobe" (ComfyUI's menu, or FUOBE_CONNECT_PAIR=1 on a PC with no screen) asks the studio for a short code.
2. You open the studio's /connect page, signed in, and approve that code.
3. This ComfyUI gets a token for you alone, kept in fuobe-connect.json, and runs your jobs (runner.py).

"Disconnect" in ComfyUI, or Disconnect in the studio's settings, ends it.
"""

from __future__ import annotations

import asyncio
import logging
import socket
import threading
import time

import aiohttp

from .net import Comfy, Site, site_base
from .runner import Runner, Unpaired
from .store import Store

log = logging.getLogger("fuobe_connect")


class Agent:
    def __init__(self, store: Store, comfy_base: str, port: int, default_site: str):
        self.store = store
        self.comfy_base = comfy_base
        self.port = port
        self.default_site = default_site
        self.loop = asyncio.new_event_loop()
        self.state = "unpaired"
        self.message: str | None = None
        self.pairing: dict | None = None
        self._runner_task: asyncio.Future | None = None
        self._pair_task: asyncio.Future | None = None
        self._session: aiohttp.ClientSession | None = None
        self._thread: threading.Thread | None = None

    # ------------------------------------------------------------------
    # Thread

    def start(self):
        self._thread = threading.Thread(target=self._main, name="fuobe-connect", daemon=True)
        self._thread.start()

    def _main(self):
        asyncio.set_event_loop(self.loop)
        self.loop.run_until_complete(self._boot())
        self.loop.run_forever()

    async def _boot(self):
        self._session = aiohttp.ClientSession()
        if self.store.load().get("token"):
            self._start_runner()

    def call(self, coro):
        """Run a coroutine on the agent's loop from any thread; returns a concurrent future."""
        return asyncio.run_coroutine_threadsafe(coro, self.loop)

    # ------------------------------------------------------------------
    # State

    def status(self) -> dict:
        data = self.store.load()
        out = {"state": self.state, "message": self.message}
        if data.get("token"):
            out["paired"] = {"site": data.get("site"), "name": data.get("name"), "since": data.get("pairedAt")}
        if self.pairing and self.state == "pairing":
            out["pairing"] = {k: self.pairing[k] for k in ("code", "url", "expiresAt", "site")}
        return out

    def _set(self, state: str, message: str | None = None):
        if (state, message) != (self.state, self.message):
            self.state, self.message = state, message
            if message:
                log.info("[Fuobe Connect] %s", message)

    # ------------------------------------------------------------------
    # Pairing

    async def start_pairing(self, site: str | None = None) -> dict:
        base = site_base(site or self.default_site)
        if self._pair_task and not self._pair_task.done():
            self._pair_task.cancel()
        comfy = Comfy(self._session, self.comfy_base)
        facts = {}
        try:
            stats = await comfy.get_json("/system_stats", timeout=10)
            dev = (stats.get("devices") or [{}])[0] or {}
            facts = {k: v for k, v in {"device": dev.get("name"), "vramBytes": dev.get("vram_total"), "version": (stats.get("system") or {}).get("comfyui_version")}.items() if v}
        except Exception:
            pass
        a = await Site(self._session, base).pair_start(socket.gethostname()[:48] or "ComfyUI", facts)
        if a.status != 200 or not a.body.get("code"):
            raise RuntimeError(a.body.get("error") or f"The studio answered HTTP {a.status}")
        self.pairing = {**a.body, "site": base}
        self._set("pairing", f"To connect this ComfyUI, open {a.body['url']} and approve the code {a.body['code']}.")
        self._pair_task = asyncio.ensure_future(self._poll(base, a.body["id"], a.body["secret"], a.body.get("pollMs") or 2000, a.body.get("expiresAt")))
        return self.status()

    async def _poll(self, base: str, pair_id: str, secret: str, poll_ms: int, expires_at: int | None):
        site = Site(self._session, base)
        until = time.time() + 11 * 60
        while time.time() < until:
            await asyncio.sleep(max(1.0, poll_ms / 1000))
            try:
                a = await site.pair_poll(pair_id, secret)
            except Exception:
                continue
            if a.status == 200 and a.body.get("state") == "approved" and a.body.get("token"):
                self.store.update(site=base, token=a.body["token"], name=a.body.get("name"), workerId=a.body.get("workerId"), pairedAt=int(time.time() * 1000))
                self.pairing = None
                self._set("connected", f"Connected to {base}. Your Fuobe jobs now run on this ComfyUI.")
                self._start_runner()
                return
            if a.status == 404 or a.body.get("state") == "gone":
                break
        self.pairing = None
        self._set("unpaired", "The code wasn't approved. Press Connect to Fuobe again for a new one.")

    def cancel_pairing(self):
        if self._pair_task and not self._pair_task.done():
            self._pair_task.cancel()
        self.pairing = None
        if self.state == "pairing":
            self._set("unpaired", None)

    async def unpair(self) -> dict:
        """Forget the token here, and tell the studio to forget it too (best effort)."""
        data = self.store.load()
        if self._runner_task and not self._runner_task.done():
            self._runner_task.cancel()
        self.store.update(token=None, workerId=None, pairedAt=None)
        self._set("unpaired", "Disconnected from Fuobe.")
        if data.get("token") and data.get("site"):
            try:
                await Site(self._session, data["site"], data["token"]).call("POST", "/api/gpu/computer/unpair", {}, timeout=10)
            except Exception:
                pass
        return self.status()

    # ------------------------------------------------------------------
    # Running jobs

    def _start_runner(self):
        if self._runner_task and not self._runner_task.done():
            return
        self._runner_task = asyncio.ensure_future(self._run())

    async def _run(self):
        backoff = 5
        while True:
            data = self.store.load()
            token, site = data.get("token"), data.get("site")
            if not token or not site:
                return
            device = f"connect-{(data.get('workerId') or 'here')}"[:64]
            runner = Runner(Site(self._session, site, token), Comfy(self._session, self.comfy_base), device, self.port, on_state=self._set)
            try:
                await runner.run_forever()
                backoff = 5
            except Unpaired:
                self.store.update(token=None, workerId=None, pairedAt=None)
                self._set("unpaired", "This ComfyUI was disconnected from Fuobe. Press Connect to Fuobe to pair it again.")
                return
            except asyncio.CancelledError:
                runner.alive = False
                raise
            except Exception as e:
                self._set("offline", f"Fuobe Connect stopped for a moment: {e}")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 120)
