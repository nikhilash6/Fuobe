"""Fuobe Connect's own small file: the studios this ComfyUI trusts, and its pairing (the studio and its token).

It lives in ComfyUI's user folder, beside (not inside) the folder ComfyUI serves as user data, and only this Windows
or Unix user may read it.
"""

from __future__ import annotations

import json
import os
import threading

FILE_NAME = "fuobe-connect.json"


class Store:
    def __init__(self, folder: str):
        self.path = os.path.join(folder, FILE_NAME)
        self._lock = threading.Lock()

    def load(self) -> dict:
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, dict) else {}
        except (OSError, ValueError):
            return {}

    def update(self, **changes) -> dict:
        """Change some keys (None removes one) and save at once."""
        with self._lock:
            data = self.load()
            for k, v in changes.items():
                if v is None:
                    data.pop(k, None)
                else:
                    data[k] = v
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            tmp = self.path + ".tmp"
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp, self.path)
            try:
                os.chmod(self.path, 0o600)
            except OSError:
                pass
            return data
