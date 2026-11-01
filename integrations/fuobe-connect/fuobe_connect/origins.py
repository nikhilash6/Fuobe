"""Which websites Fuobe Connect trusts, and the paths they may use.

Pure (no ComfyUI imports), so the tests load it on its own.

A trusted site is a Fuobe studio: https://fuobe.com unless you name others. Only an exact origin counts (scheme, host
and port). A trusted site may use only what a Fuobe run needs: the facts about this ComfyUI, its queue and history,
its results, uploading a run's inputs and queueing its prompt. It never reaches the Manager's install calls, your
user files or settings: those stay behind ComfyUI's own check, as for every other website.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlsplit

DEFAULT_STUDIOS = ("https://fuobe.com",)

# A site that is also reached under "www.".
_WWW_TWINS = {"fuobe.com"}

_DEFAULT_PORTS = {"http": 80, "https": 443}


def normalise(origin: str | None) -> str | None:
    """'https://Fuobe.com/' -> 'https://fuobe.com'. None for anything that isn't an http(s) origin."""
    if not origin or not isinstance(origin, str):
        return None
    text = origin.strip()
    if len(text) > 300:
        return None
    try:
        u = urlsplit(text)
        port = u.port
    except ValueError:
        return None
    if u.scheme not in ("http", "https") or not u.hostname:
        return None
    if u.username or u.password or u.query or u.fragment or u.path not in ("", "/"):
        return None
    host = u.hostname.lower().rstrip(".")
    if ":" in host:
        host = f"[{host}]"
    if port is not None and port != _DEFAULT_PORTS[u.scheme]:
        return f"{u.scheme}://{host}:{port}"
    return f"{u.scheme}://{host}"


def parse_list(text: str | list | tuple | None) -> list[str]:
    """A comma- or space-separated list (or a list) of origins: the valid ones, in order, without repeats."""
    if text is None:
        return []
    items = text if isinstance(text, (list, tuple)) else re.split(r"[\s,]+", str(text))
    out: list[str] = []
    for item in items:
        o = normalise(item) if isinstance(item, str) else None
        if o and o not in out:
            out.append(o)
    return out


def with_twins(origins: list[str]) -> list[str]:
    out = list(origins)
    for o in origins:
        u = urlsplit(o)
        if u.hostname in _WWW_TWINS:
            twin = f"{u.scheme}://www.{u.hostname}" + (f":{u.port}" if u.port else "")
            if twin not in out:
                out.append(twin)
    return out


def trusted_origins(env_value: str | None, configured: str | list | None) -> tuple[str, ...]:
    """FUOBE_CONNECT_ORIGINS when set, else the configured studios, else https://fuobe.com."""
    for source in (env_value, configured):
        found = parse_list(source)
        if found:
            return tuple(with_twins(found))
    return tuple(with_twins(list(DEFAULT_STUDIOS)))


# ---------------------------------------------------------------------------
# What a trusted site may use (ComfyUI answers each path with and without "/api" in front).

_GET = re.compile(
    r"^/(?:"
    r"system_stats|object_info(?:/[^/]{1,128})?|models(?:/[A-Za-z0-9_.-]{1,64})?|embeddings|queue|features"
    r"|history(?:/[0-9a-f-]{36})?|jobs(?:/[0-9a-f-]{36})?|view|ws"
    r"|experiment/models(?:/[A-Za-z0-9_.-]{1,64})?"
    r"|(?:v2/)?manager/(?:version|queue/status)|(?:v2/)?customnode/installed"
    r"|fuobe/connect|fuobe/guard"
    r")$"
)
_POST = re.compile(
    r"^/(?:upload/image|prompt|queue|interrupt|jobs/[0-9a-f-]{36}/cancel|(?:v2/)?customnode/import_fail_info(?:_bulk)?)$"
)


def _bare(path: str) -> str:
    return path[4:] if path.startswith("/api/") else path


def allowed(method: str, path: str, query: str = "") -> bool:
    """May a trusted site send this? (`query`: the raw query string; /view is only for results.)"""
    p = _bare(path)
    m = method.upper()
    if m in ("GET", "HEAD"):
        if not _GET.match(p):
            return False
        if p == "/view":
            q = parse_qs(query, keep_blank_values=True)
            return q.get("type", ["output"])[0] in ("output", "temp")
        return True
    if m == "POST":
        return bool(_POST.match(p))
    return False


def same_host(origin: str, host: str | None) -> bool:
    """The page is ComfyUI's own (the origin's host and port are the Host header's)."""
    try:
        o = urlsplit(origin)
        h = urlsplit("//" + (host or "").strip().lower())
        if not o.hostname or not h.hostname or o.hostname.lower() != h.hostname:
            return False
        return o.port is None or h.port is None or o.port == h.port
    except ValueError:
        return False
