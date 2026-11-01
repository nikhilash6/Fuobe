"""Load the pack outside ComfyUI: a stand-in folder_paths module, and the pack imported as a package by its path.

Run from the pack's folder, in a venv of its own (never a live ComfyUI's Python):
    python -I -m pytest -q tests
The real-weight tests run only when RE_USE_WEIGHTS names model.safetensors (see test_real_weights.py).
"""
import importlib.util
import os
import sys
import tempfile
import types

import pytest

PACK = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _fake_folder_paths(models_dir):
    fp = types.ModuleType("folder_paths")
    fp.models_dir = models_dir
    fp.folder_names_and_paths = {}

    def get_filename_list(name):
        out = []
        for d in fp.folder_names_and_paths[name][0]:
            if os.path.isdir(d):
                out += sorted(f for f in os.listdir(d) if os.path.splitext(f)[1] in fp.folder_names_and_paths[name][1])
        return out

    def get_full_path(name, f):
        for d in fp.folder_names_and_paths[name][0]:
            p = os.path.join(d, f)
            if os.path.isfile(p):
                return p
        return None

    fp.get_filename_list = get_filename_list
    fp.get_full_path = get_full_path
    return fp


def _load_pack():
    models = tempfile.mkdtemp(prefix="reuse-models-")
    sys.modules["folder_paths"] = _fake_folder_paths(models)
    spec = importlib.util.spec_from_file_location("comfyui_re_use", os.path.join(PACK, "__init__.py"), submodule_search_locations=[PACK])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["comfyui_re_use"] = mod
    spec.loader.exec_module(mod)
    return mod, models


_PACK, _MODELS = _load_pack()


@pytest.fixture(scope="session")
def pack():
    return _PACK


@pytest.fixture(scope="session")
def engine():
    return sys.modules["comfyui_re_use.reuse_engine"]


@pytest.fixture(scope="session")
def nodes():
    return sys.modules["comfyui_re_use.nodes"]


@pytest.fixture(scope="session")
def models_dir():
    return _MODELS
