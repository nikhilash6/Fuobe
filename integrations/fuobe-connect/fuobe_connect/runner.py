"""Running a person's Fuobe jobs on this ComfyUI, after pairing.

The same protocol the Fuobe tab speaks (src/lib/computer-runner.ts in the Fuobe repo): beat to say this computer is
here, claim the person's next job, send its inputs and its exact graph to this ComfyUI, follow it, report back, and
upload the results the studio asks for. It decides nothing about a result. Only that person's jobs reach it: the studio
picks them by the token, which belongs to one person.

A job's graph may read only the files that job sent, and a result is uploaded only when this job's own prompt saved it
(graph.py). One job at a time.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
import uuid

import aiohttp

from .graph import graph_problem, has_prefix, may_download, safe_wanted, slim, UUID
from .net import Comfy, Site

log = logging.getLogger("fuobe_connect")

BEAT_S = 10
BUSY_BEAT_S = 5
POLL_S = 1.0
PROGRESS_EVERY_S = 0.5
PART_BYTES = 16 * 2**20
SAVE_WAIT_S = 60 * 60


class Stopped(Exception):
    """The job ended on the studio, or another computer has it now: let go of it."""


class Unpaired(Exception):
    """The studio no longer knows this token."""


def _retry_after(headers: dict) -> float:
    try:
        return min(30.0, max(1.0, float(headers.get("Retry-After") or headers.get("retry-after") or 2)))
    except ValueError:
        return 2.0


class Runner:
    def __init__(self, site: Site, comfy: Comfy, device: str, port: int, on_state=None, sleep=asyncio.sleep, clock=time.monotonic):
        self.site = site
        self.comfy = comfy
        self.device = device
        self.port = port
        self.client_id = uuid.uuid4().hex
        self.on_state = on_state or (lambda state, message=None: None)
        self.sleep = sleep
        self.clock = clock
        self.alive = True
        self.jobs: dict[str, dict] = {}
        self.events: dict[str, dict] = {}
        self.stopped_done: set[str] = set()
        self.stopping: set[str] = set()
        self.jobs_api: bool | None = None
        self.facts_at = -1e9
        self.loras_at = -1e9
        self.runner = False
        self.ws_task: asyncio.Task | None = None
        self.ws_open = False
        self.comfy_ok = False

    # ------------------------------------------------------------------
    # This ComfyUI

    async def look(self) -> dict | None:
        try:
            stats = await self.comfy.get_json("/system_stats", timeout=10)
            self.comfy_ok = True
            return stats
        except Exception:
            self.comfy_ok = False
            return None

    async def facts(self, loras: bool) -> dict | None:
        s = await self.look()
        if not s:
            return None
        system = s.get("system") or {}
        dev = (s.get("devices") or [{}])[0] or {}
        f = {"guard": True}
        if isinstance(dev.get("name"), str):
            f["device"] = dev["name"][:120]
        if isinstance(dev.get("vram_total"), (int, float)):
            f["vramBytes"] = dev["vram_total"]
        if isinstance(system.get("ram_total"), (int, float)):
            f["ramBytes"] = system["ram_total"]
        if system.get("comfyui_version"):
            f["version"] = str(system["comfyui_version"])[:40]
        if system.get("os"):
            f["os"] = str(system["os"])[:40]
        if isinstance(system.get("embedded_python"), bool):
            f["portable"] = system["embedded_python"]
        if loras:
            try:
                names = await self.comfy.get_json("/models/loras")
                if isinstance(names, list):
                    f["loras"] = [n for n in names if isinstance(n, str)][:20000]
            except Exception:
                pass
        return f

    def _socket(self):
        if self.ws_task and not self.ws_task.done():
            return
        self.ws_task = asyncio.ensure_future(self._listen())

    async def _listen(self):
        try:
            async with self.comfy.session.ws_connect(self.comfy.ws_url(self.client_id), heartbeat=30, ssl=self.comfy._ssl) as ws:
                self.ws_open = True
                async for msg in ws:
                    if msg.type != aiohttp.WSMsgType.TEXT:
                        continue
                    try:
                        m = json.loads(msg.data)
                    except ValueError:
                        continue
                    d = m.get("data") if isinstance(m, dict) and isinstance(m.get("data"), dict) else {}
                    pid = d.get("prompt_id")
                    if not isinstance(pid, str):
                        continue
                    cur = self.events.setdefault(pid, {"nodesDone": 0})
                    t = m.get("type")
                    if t == "progress" and isinstance(d.get("value"), (int, float)) and isinstance(d.get("max"), (int, float)):
                        cur.update(value=d["value"], max=d["max"], node=d.get("node"))
                    elif t == "executing" and d.get("node"):
                        cur.update(node=d["node"], nodesDone=cur["nodesDone"] + 1, value=None, max=None)
        except Exception:
            pass
        finally:
            self.ws_open = False

    async def where(self, prompt_id: str, prefix: str | None = None) -> dict:
        if self.jobs_api is None:
            try:
                await self.comfy.get_json("/api/jobs")
                self.jobs_api = True
            except Exception:
                self.jobs_api = False
        if self.jobs_api:
            status, j = await self.comfy.get_status(f"/api/jobs/{prompt_id}")
            if status == 404:
                return await self.where_by_queue(prompt_id) if prefix else {"s": "absent"}
            if status != 200:
                raise RuntimeError(f"ComfyUI answered HTTP {status}")
            st = (j or {}).get("status")
            if st == "in_progress":
                return {"s": "running"}
            if st == "pending":
                return await self.where_by_queue(prompt_id)
            entry = (await self.comfy.get_json(f"/history/{prompt_id}")).get(prompt_id)
            return {"s": "done", "entry": entry} if entry else {"s": "absent"}
        entry = (await self.comfy.get_json(f"/history/{prompt_id}")).get(prompt_id)
        if entry and ((entry.get("status") or {}).get("completed") or (entry.get("status") or {}).get("status_str")):
            return {"s": "done", "entry": entry}
        return await self.where_by_queue(prompt_id)

    async def where_by_queue(self, prompt_id: str) -> dict:
        q = await self.comfy.get_json("/queue")
        running = q.get("queue_running") or []
        if any(len(r) > 1 and r[1] == prompt_id for r in running):
            return {"s": "running"}
        pending = sorted(q.get("queue_pending") or [], key=lambda r: float(r[0]) if r else 0)
        for i, r in enumerate(pending):
            if len(r) > 1 and r[1] == prompt_id:
                return {"s": "pending", "ahead": i + len(running)}
        entry = (await self.comfy.get_json(f"/history/{prompt_id}")).get(prompt_id)
        return {"s": "done", "entry": entry} if entry else {"s": "absent"}

    # ------------------------------------------------------------------
    # The studio

    async def report(self, t: dict, event: dict) -> dict:
        until = self.clock() + 120
        tries = 0
        while True:
            a = await self.site.call("POST", f"/api/gpu/computer/tasks/{t['id']}/report", event, headers={"X-Fuobe-Lease": t["lease"]})
            if a.status == 200:
                return a.body
            if a.status == 401:
                raise Unpaired()
            if a.status in (404, 409):
                raise Stopped()
            if a.status == 429 and self.clock() < until:
                await self.sleep(_retry_after(a.headers))
                continue
            tries += 1
            if tries > 4:
                raise RuntimeError(f"The studio answered HTTP {a.status}")
            await self.sleep(tries)

    async def beat(self) -> dict | None:
        now = self.clock()
        due = now - self.facts_at > 60
        loras = due and now - self.loras_at > 300
        read = await self.facts(loras) if due else (await self.look() and {})
        body: dict = {"device": self.device, "port": self.port, "ready": read is not None}
        if due and read:
            self.facts_at = now
            if loras:
                self.loras_at = now
            body["facts"] = read
        running = []
        for task_id, j in self.jobs.items():
            if j["phase"] in ("done", "failed"):
                continue
            item = {"task": task_id}
            if j.get("position") is not None:
                item["position"] = j["position"]
            ev = self.events.get(j.get("promptId", ""))
            if j["phase"] == "running" and ev:
                item.update({k: ev[k] for k in ("value", "max", "nodesDone") if ev.get(k) is not None})
            running.append(item)
        body["running"] = running
        stopped = list(self.stopped_done)
        if stopped:
            body["stopped"] = stopped
        a = await self.site.call("POST", "/api/gpu/computer/beat", body)
        if a.status == 401:
            raise Unpaired()
        if a.status != 200:
            self.runner = False
            self.on_state("waiting", a.body.get("error") or f"The studio answered HTTP {a.status}")
            return None
        for s in stopped:
            self.stopped_done.discard(s)
        self.runner = bool(a.body.get("runner"))
        if not self.comfy_ok:
            self.on_state("comfy-down", "ComfyUI isn't answering here.")
        elif self.runner:
            self.on_state("connected", None)
        else:
            self.on_state("elsewhere", "Another computer runs your Fuobe jobs now.")
        for s in a.body.get("stops") or []:
            asyncio.ensure_future(self.take_off(s))
        return a.body

    async def take_off(self, s: dict):
        task_id = s.get("task")
        pid = s.get("promptId")
        if not isinstance(task_id, str) or task_id in self.stopping or not isinstance(pid, str) or not UUID.match(pid):
            return
        self.stopping.add(task_id)
        try:
            if self.jobs_api is not False:
                status, _ = await self.comfy.post_json(f"/api/jobs/{pid}/cancel", {})
                if status == 404:
                    self.jobs_api = False
            if self.jobs_api is False:
                await self.comfy.post_json("/queue", {"delete": [pid]})
                q = await self.comfy.get_json("/queue")
                if any(len(r) > 1 and r[1] == pid for r in q.get("queue_running") or []):
                    await self.comfy.post_json("/interrupt", {"prompt_id": pid})
            prefix = s.get("prefix")
            if isinstance(prefix, str) and prefix:
                for _ in range(5):
                    q = await self.comfy.get_json("/queue")
                    ids = [str(r[1]) for r in (q.get("queue_running") or []) + (q.get("queue_pending") or []) if len(r) > 2 and has_prefix(r[2], prefix)]
                    if not ids:
                        break
                    for i in ids:
                        await self.comfy.post_json(f"/api/jobs/{i}/cancel", {})
                    await self.sleep(1)
            self.stopped_done.add(task_id)
        except Exception as e:
            log.warning("[Fuobe Connect] Couldn't stop a job: %s", e)
        finally:
            self.stopping.discard(task_id)
            j = self.jobs.get(task_id)
            if j and j["phase"] != "done":
                j["phase"] = "failed"

    async def claim_and_run(self) -> bool:
        if not self.alive or not self.runner or not await self.look():
            return False
        running = [k for k, j in self.jobs.items() if j["phase"] not in ("done", "failed")]
        a = await self.site.call("POST", "/api/gpu/computer/claim", {"device": self.device, "running": running})
        if a.status == 401:
            raise Unpaired()
        if a.status != 200:
            return False
        t = a.body.get("task")
        if not isinstance(t, dict):
            return False
        try:
            await self.run(t)
        except (Stopped, asyncio.CancelledError):
            raise
        except Unpaired:
            raise
        except Exception as e:
            log.warning("[Fuobe Connect] A job stopped here: %s", e)
            self.jobs.pop(t["id"], None)
        return True

    # ------------------------------------------------------------------
    # One job

    def _job(self, t: dict, **patch):
        j = self.jobs.setdefault(t["id"], {"phase": "sending", "promptId": t.get("promptId")})
        j.update(patch)
        done = [k for k, v in self.jobs.items() if v["phase"] in ("done", "failed")]
        for k in done[:-6]:
            self.jobs.pop(k, None)

    async def run(self, t: dict):
        resume = t.get("resume")
        self._job(t, phase={"collecting": "saving", "running": "running", "queued": "queued"}.get(resume, "sending"), promptId=t.get("promptId"))
        try:
            names = [i["name"] for i in t.get("inputs") or []]
            if graph_problem(t.get("graph"), names):
                await self.report(t, {"event": "failed", "reason": "unsafe-graph"})
                return self._job(t, phase="failed")
            entries = None
            wanted = t.get("wanted")
            phase = resume or "sending"
            for _ in range(3):
                if phase == "collecting":
                    break
                if phase == "sending" and not await self.send_job(t):
                    return
                self._socket()
                done = await self.follow(t)
                if done == "gone":
                    a = await self.report(t, {"event": "gone"})
                    if a.get("state") != "sending":
                        return self._job(t, phase="failed")
                    phase = "sending"
                    continue
                entries = done["entries"]
                if not done["answer"].get("wanted"):
                    return self._job(t, phase="done" if done["answer"].get("state") == "done" else "failed")
                wanted = done["answer"]["wanted"]
                phase = "collecting"
            if phase != "collecting" or not wanted:
                return
            if entries is None:
                entries = await self.own_entries(t)
            await self.collect(t, wanted, entries, t.get("received") or [])
        except Stopped:
            self._job(t, phase="failed")

    async def own_entries(self, t: dict) -> list:
        try:
            own = (await self.comfy.get_json(f"/history/{t['promptId']}")).get(t["promptId"])
        except Exception:
            own = None
        passes = []
        if t.get("prefix"):
            try:
                recent = await self.comfy.get_json("/history?max_items=64")
                passes = [e for e in recent.values() if has_prefix((e.get("prompt") or [None, None, None])[2], t["prefix"])]
            except Exception:
                pass
        return ([own] if own else []) + passes

    async def wait_for_comfy(self, t: dict):
        told = False
        while True:
            if not self.alive:
                raise Stopped()
            if await self.look():
                return
            if not told:
                a = await self.report(t, {"event": "comfy-down"})
                if a.get("stop"):
                    raise Stopped()
                told = True
            await self.sleep(3)

    async def send_job(self, t: dict) -> bool:
        self._job(t, phase="sending")
        try:
            there = await self.where(t["promptId"])
        except Exception:
            there = None
        if there and there["s"] != "absent":
            await self.report(t, {"event": "sent", "promptId": t["promptId"]})
            return True
        if there is None:
            await self.wait_for_comfy(t)
        for inp in t.get("inputs") or []:
            status, data, headers = await self.site.read(f"/api/gpu/computer/tasks/{t['id']}/inputs/{inp['n']}", headers={"X-Fuobe-Lease": t["lease"]})
            if status == 401:
                raise Unpaired()
            if status in (404, 409):
                raise Stopped()
            if status != 200:
                raise RuntimeError(f"The studio answered HTTP {status} for a file")
            if hashlib.sha256(data).hexdigest() != inp.get("sha256"):
                await self.report(t, {"event": "failed", "reason": "input-changed"})
                self._job(t, phase="failed")
                return False
            try:
                up = await self.comfy.upload_input(inp["name"], data, inp.get("contentType") or "application/octet-stream")
            except Exception:
                await self.wait_for_comfy(t)
                return await self.send_job(t)
            if up != 200:
                await self.report(t, {"event": "failed", "reason": "input-too-big" if up == 413 else "comfy-error", "status": up})
                self._job(t, phase="failed")
                return False
        body = {"prompt": t["graph"], "prompt_id": t["promptId"], "client_id": self.client_id}
        if t.get("preview"):
            body["extra_data"] = {"preview_method": "auto"}
        try:
            status, answer = await self.comfy.post_json("/prompt", body)
        except Exception:
            await self.wait_for_comfy(t)
            return await self.send_job(t)
        if status == 400:
            await self.report(t, {"event": "refused", "status": 400, "body": answer})
            self._job(t, phase="failed")
            return False
        if status != 200 or not isinstance(answer.get("prompt_id"), str):
            await self.report(t, {"event": "failed", "reason": "comfy-error", "status": status})
            self._job(t, phase="failed")
            return False
        if answer["prompt_id"] != t["promptId"]:
            t["promptId"] = answer["prompt_id"]
            self._job(t, promptId=t["promptId"])
        ev = {"event": "sent", "promptId": answer["prompt_id"]}
        if isinstance(answer.get("number"), (int, float)):
            ev["number"] = answer["number"]
        await self.report(t, ev)
        return True

    async def follow(self, t: dict):
        last_sent = -1e9
        last_key = ""
        following = None
        while True:
            if not self.alive:
                raise Stopped()
            if following:
                try:
                    q = await self.comfy.get_json("/queue")
                except Exception:
                    await self.wait_for_comfy(t)
                    continue
                running = any(len(r) > 2 and has_prefix(r[2], following) for r in (q.get("queue_running") or []) + (q.get("queue_pending") or []))
                try:
                    recent = await self.comfy.get_json("/history?max_items=64")
                except Exception:
                    recent = {}
                passes = [e for e in recent.values() if has_prefix((e.get("prompt") or [None, None, None])[2], following)]
                a = await self.report(t, {"event": "passes", "running": running, "entries": [] if running else [slim(e) for e in passes]})
                if a.get("stop"):
                    raise Stopped()
                if not running:
                    return {"entries": passes, "answer": a}
                self._job(t, phase="running")
                await self.sleep(POLL_S * 2)
                continue
            try:
                w = await self.where(t["promptId"])
            except Exception:
                await self.wait_for_comfy(t)
                continue
            if w["s"] == "absent":
                return "gone"
            if w["s"] == "done":
                a = await self.report(t, {"event": "finished", "entry": slim(w["entry"])})
                if a.get("stop"):
                    raise Stopped()
                if a.get("follow"):
                    following = a["follow"]
                    continue
                return {"entries": [w["entry"]], "answer": a}
            ev = self.events.get(t["promptId"]) or {}
            if w["s"] == "pending":
                rep = {"event": "queued", "position": w["ahead"]}
            else:
                rep = {"event": "running", **{k: ev[k] for k in ("value", "max", "node", "nodesDone") if ev.get(k) is not None}}
            key = json.dumps(rep, sort_keys=True)
            if key != last_key and self.clock() - last_sent >= PROGRESS_EVERY_S:
                a = await self.report(t, rep)
                if a.get("stop"):
                    raise Stopped()
                last_key = key
                last_sent = self.clock()
            self._job(t, phase="queued" if w["s"] == "pending" else "running", position=w.get("ahead"))
            await self.sleep(PROGRESS_EVERY_S if self.ws_open else POLL_S)

    async def collect(self, t: dict, wanted: list, entries: list, received: list):
        self._job(t, phase="saving")
        for w in wanted:
            got = next((r for r in received if r.get("n") == w.get("n")), None)
            if got and got.get("done"):
                continue
            if not safe_wanted(w) or not may_download(w, entries):
                await self.report(t, {"event": "failed", "reason": "output-missing"})
                return self._job(t, phase="failed")
            data = await self.comfy.view(w["filename"], w.get("subfolder") or "", w["type"])
            if data is None:
                await self.report(t, {"event": "failed", "reason": "output-missing"})
                return self._job(t, phase="failed")
            offset = (got or {}).get("bytes") or 0
            if offset > 0:
                s = await self.site.call("GET", f"/api/gpu/computer/tasks/{t['id']}/outputs/{w['n']}", headers={"X-Fuobe-Lease": t["lease"]})
                offset = s.body.get("received", 0) if s.status == 200 else 0
            if not await self.upload(t, w, data, offset):
                return self._job(t, phase="failed")
        self._job(t, phase="done")

    async def upload(self, t: dict, w: dict, data: bytes, offset: int) -> bool:
        fails = 0
        until = self.clock() + SAVE_WAIT_S
        total = len(data)
        while offset < total or total == 0:
            if not self.alive:
                raise Stopped()
            part = data[offset : offset + PART_BYTES]
            try:
                a = await self.site.call(
                    "PUT",
                    f"/api/gpu/computer/tasks/{t['id']}/outputs/{w['n']}?offset={offset}&total={total}",
                    data=part,
                    headers={"X-Fuobe-Lease": t["lease"], "Content-Type": "application/octet-stream"},
                    timeout=600,
                )
            except Exception:
                a = None
            if a and a.status == 200:
                offset = int(a.body.get("received", offset))
                fails = 0
                if a.body.get("done"):
                    return True
                continue
            if a and a.status == 429 and self.clock() < until:
                await self.sleep(_retry_after(a.headers))
                continue
            if a and a.status in (404, 413, 415):
                return False
            if a and a.status == 401:
                raise Unpaired()
            if a and a.status == 409:
                s = await self.site.call("GET", f"/api/gpu/computer/tasks/{t['id']}/outputs/{w['n']}", headers={"X-Fuobe-Lease": t["lease"]})
                if s.status != 200:
                    return False
                if s.body.get("done"):
                    return True
                offset = int(s.body.get("received", 0))
            fails += 1
            if fails >= 3:
                try:
                    await self.report(t, {"event": "failed", "reason": "save-failed"})
                except Exception:
                    pass
                return False
            await self.sleep(1.5 * fails)
        return True

    # ------------------------------------------------------------------
    # The loops

    async def beat_loop(self):
        while self.alive:
            busy = any(j["phase"] not in ("done", "failed") for j in self.jobs.values())
            try:
                a = await self.beat()
                wait = BUSY_BEAT_S if busy or (a and a.get("waiting")) else BEAT_S
                if a is None:
                    wait = 30
            except Unpaired:
                raise
            except Exception as e:
                self.on_state("offline", f"Can't reach the studio: {e}")
                wait = 30
            await self.sleep(wait)

    async def work_loop(self):
        while self.alive:
            try:
                did = await self.claim_and_run()
            except Stopped:
                did = True
            except Unpaired:
                raise
            except Exception as e:
                log.warning("[Fuobe Connect] %s", e)
                did = False
            if not did:
                await self.sleep(2)

    async def run_forever(self):
        """Beat and work until stopped. Raises Unpaired when the studio forgot this token."""
        beats = asyncio.ensure_future(self.beat_loop())
        work = asyncio.ensure_future(self.work_loop())
        try:
            done, _ = await asyncio.wait({beats, work}, return_when=asyncio.FIRST_EXCEPTION)
            for d in done:
                if d.exception():
                    raise d.exception()
        finally:
            self.alive = False
            for task in (beats, work, self.ws_task):
                if task and not task.done():
                    task.cancel()
