"""Fuobe Connect's own graph checks (graph.py), alone: the node list, path-like text, the loaders, and what goes back
to the studio."""

from __future__ import annotations

import glob
import json
import os
import re
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
PACK = os.path.dirname(HERE)
sys.path.insert(0, PACK)

from fuobe_connect import __version__  # noqa: E402
from fuobe_connect.graph import (  # noqa: E402
    OWN_NODES_FILE,
    NodeList,
    graph_problem,
    may_download,
    refusal,
    run_prefix,
    safe_wanted,
    shipped_nodes,
    slim,
    staged_name_ok,
    vet_graph,
)

B = chr(92)  # a backslash
NODES = frozenset({"LoadImage", "SaveImage", "CLIPTextEncode", "Load3D", "VHS_LoadVideo", "LoadImagesFromFolderKJ", "LoadImageFromUrl", "Image Load", "Image Saver", "PrimitiveString"})
STAGED = ["fuobe_abcdefgh12.png", "fuobe_abcdefgh34.spz"]


def g(*nodes) -> dict:
    return {str(i + 1): n for i, n in enumerate(nodes)}


def node(cls, **inputs) -> dict:
    return {"class_type": cls, "inputs": inputs}


class NamesTest(unittest.TestCase):
    def test_staged_names(self):
        for ok in ["fuobe_abcdefgh12.png", "fuobe_ABC-def_1234.mp4", "fuobe_abcdefgh12.spz", "fuobe_abcdefgh12.wav"]:
            self.assertTrue(staged_name_ok(ok), ok)
        for bad in ["my_photo.png", "fuobe_short.png", "fuobe_abcdefgh12.html", "fuobe_abcdefgh12.svg", "fuobe_abcdefgh12.py", "fuobe_abcdefgh12.js", "fuobe_abcdefgh12.png [output]", "../fuobe_abcdefgh12.png", None, 3]:
            self.assertFalse(staged_name_ok(bad), bad)


class VetTest(unittest.TestCase):
    def test_unknown_node(self):
        self.assertEqual(vet_graph(g(node("KJ_RunPython", code="import os")), NODES, STAGED), "unknown-node")
        self.assertEqual(vet_graph(g({"inputs": {}}), NODES, STAGED), "unknown-node")
        self.assertEqual(vet_graph({}, NODES, STAGED), "unsafe-graph")
        self.assertEqual(vet_graph("x", NODES, STAGED), "unsafe-graph")

    def test_path_like_text(self):
        for v in [
            "C:/Users/me/Pictures",
            "C:" + B + "Users" + B + "me",
            B + B + "server" + B + "share",
            "/etc/passwd",
            "/secret.png",
            "../../secret.png",
            "fuobe/" + ".." + "/x",
            "~/.ssh/id_rsa",
            "http://192.168.1.1/admin",
            "https://example.com/x.png",
            "file:///etc/passwd",
            "blake3:0123456789abcdef",
            "ComfyUI_00001_.png [output]",
            "preview.png [temp]",
            "holiday.png [input]",
        ]:
            self.assertEqual(vet_graph(g(node("CLIPTextEncode", text=v)), NODES, STAGED), "unsafe-path", v)
        # Ordinary words, a staged input with its folder tag, a Fuobe prefix, a model in a subfolder: fine.
        for v in ["a red door", "wait.. what?", "...", "fuobe/gen123abc", "flux/model.safetensors", "1/2 cup", "fuobe_abcdefgh12.png [input]"]:
            self.assertIsNone(vet_graph(g(node("CLIPTextEncode", text=v)), NODES, STAGED), v)

    def test_nodes_that_read_or_fetch(self):
        """Nodes from common packs that read any folder, fetch a URL or write anywhere: refused by the list, and by the
        path check when the person added them to their own list."""
        risky = [
            node("LoadImagesFromFolderKJ", folder="C:/Users/me/Pictures"),
            node("LoadImageFromUrl", url="http://192.168.1.1/admin"),
            node("Image Load", image_path="C:/ProgramData/x.png"),
            node("Image Saver", path="C:/ProgramData/Microsoft/Windows/Start Menu", images=["1", 0]),
        ]
        for n in risky:
            self.assertEqual(vet_graph(g(n), frozenset({"SaveImage"}), STAGED), "unknown-node", n)
            self.assertEqual(vet_graph(g(n), NODES, STAGED), "unsafe-path", n)

    def test_loaders_read_only_this_runs_files(self):
        self.assertIsNone(vet_graph(g(node("LoadImage", image="fuobe_abcdefgh12.png")), NODES, STAGED))
        self.assertIsNone(vet_graph(g(node("LoadImage", image="fuobe_abcdefgh12.png [input]")), NODES, STAGED))
        for bad in [
            node("LoadImage", image="my_photo.png"),
            node("LoadImage", image="fuobe_zzzzzzzz99.png"),  # a Fuobe name, but not this run's
            node("LoadImage", image=["2", 0]),  # a name another node works out
            node("VHS_LoadVideo", video="clip.mp4"),
            node("Load3D", model_file="3d/scene.spz"),
            node("Load3D", model_file="fuobe_abcdefgh34.spz", image={"image": "secret.png", "camera_info": {}}),
        ]:
            self.assertEqual(vet_graph(g(bad, node("PrimitiveString", value="x")), NODES, STAGED), "unsafe-graph", bad)
        self.assertIsNone(vet_graph(g(node("Load3D", model_file="fuobe_abcdefgh34.spz", image={"image": "fuobe_abcdefgh12.png", "mask": "", "camera_info": {"x": 1}})), NODES, STAGED))
        # Direct mode doesn't know the run: any name Fuobe gives an input.
        self.assertIsNone(graph_problem(g(node("LoadImage", image="fuobe_zzzzzzzz99.png")), None))
        self.assertIsNotNone(graph_problem(g(node("LoadImage", image="my_photo.png")), None))

    def test_studio_workflows_pass(self):
        """Every workflow Fuobe ships uses only listed nodes and no path-like text (when the pack is inside Fuobe)."""
        folder = os.path.join(PACK, "..", "..", "workflows", "comfyui")
        files = [f for f in glob.glob(os.path.join(folder, "*.json")) if os.path.basename(f) not in ("requirements.json", "manifest.json", "object_info.subset.json")]
        if not files:
            self.skipTest("Fuobe's workflows aren't beside this copy of the pack")
        nodes = shipped_nodes()
        checked = 0
        for f in files:
            with open(f, encoding="utf-8") as fh:
                wf = json.load(fh)
            if not isinstance(wf, dict) or not all(isinstance(n, dict) and "class_type" in n for n in wf.values()):
                continue
            checked += 1
            # Their loaders still name placeholder files (the studio stages the real ones), so only these two reasons.
            self.assertNotIn(vet_graph(wf, nodes, None), ("unknown-node", "unsafe-path"), os.path.basename(f))
        self.assertGreater(checked, 50)


class NodeListTest(unittest.TestCase):
    def test_shipped_and_own(self):
        shipped = shipped_nodes()
        self.assertIn("LoadImage", shipped)
        self.assertIn("SaveImage", shipped)
        self.assertNotIn("LoadImagesFromFolderKJ", shipped)
        with tempfile.TemporaryDirectory() as d:
            nodes = NodeList(d)
            self.assertEqual(nodes(), shipped)
            with open(os.path.join(d, OWN_NODES_FILE), "w", encoding="utf-8") as f:
                json.dump({"nodes": ["MyOwnNode"]}, f)
            self.assertIn("MyOwnNode", nodes())
            os.remove(os.path.join(d, OWN_NODES_FILE))
            self.assertNotIn("MyOwnNode", nodes())


class ResultsTest(unittest.TestCase):
    def test_wanted(self):
        self.assertTrue(safe_wanted({"filename": "a.png", "subfolder": "fuobe", "type": "output"}))
        for w in [
            {"filename": "a.png", "subfolder": "", "type": "input"},
            {"filename": "../a.png", "subfolder": "", "type": "output"},
            {"filename": "a.png [input]", "subfolder": "", "type": "output"},
            {"filename": "blake3:abc", "subfolder": "", "type": "output"},
            {"filename": "a.png", "subfolder": "..", "type": "output"},
            {"filename": "a.png", "subfolder": "/etc", "type": "output"},
            {"filename": "a.png", "subfolder": "C:/x", "type": "output"},
        ]:
            self.assertFalse(safe_wanted(w), w)
        entries = [{"outputs": {"9": {"images": [{"filename": "a.png", "subfolder": "fuobe", "type": "output"}]}}}]
        self.assertTrue(may_download({"filename": "a.png", "subfolder": "fuobe", "type": "output"}, entries))
        self.assertFalse(may_download({"filename": "b.png", "subfolder": "fuobe", "type": "output"}, entries))

    def test_prefix(self):
        graph = g(node("SaveImage", filename_prefix="fuobe/gen123abc"))
        self.assertEqual(run_prefix("fuobe/gen123abc", graph), "fuobe/gen123abc")
        # The person's own prefix, or one this run's graph doesn't save under: none.
        self.assertIsNone(run_prefix("ComfyUI", g(node("SaveImage", filename_prefix="ComfyUI"))))
        self.assertIsNone(run_prefix("fuobe/other12345", graph))
        self.assertIsNone(run_prefix("fuobe/../x", graph))

    def test_slim_drops_traceback_and_folders(self):
        e = {
            "prompt": [1, "p", {"big": "graph"}, {}, []],
            "outputs": {"9": {"images": []}},
            "status": {"status_str": "error", "completed": False, "messages": [["execution_error", {"node_id": "4", "node_type": "X", "exception_message": "No file C:" + B + "Users" + B + "alice" + B + "ComfyUI" + B + "x.png", "traceback": ["File C:/ComfyUI/nodes.py"]}]]},
        }
        s = slim(e)
        self.assertEqual(s["prompt"], [1, "p"])
        msg = s["status"]["messages"][0][1]
        self.assertNotIn("traceback", msg)
        self.assertNotIn("alice", msg["exception_message"])
        self.assertEqual(msg["node_type"], "X")

    def test_refusal_keeps_what_the_studio_needs(self):
        answer = {
            "error": {"type": "prompt_outputs_failed_validation", "message": "Prompt outputs failed validation", "details": "x", "extra_info": {}},
            "node_errors": {
                "4": {
                    "class_type": "CheckpointLoaderSimple",
                    "dependent_outputs": ["9"],
                    "errors": [
                        {
                            "type": "value_not_in_list",
                            "message": "Value not in list",
                            "details": "ckpt_name: 'flux.safetensors' not in ['my_private_model.safetensors', 'another.ckpt']",
                            "extra_info": {"input_name": "ckpt_name", "received_value": "flux.safetensors", "input_config": [["my_private_model.safetensors"]]},
                        }
                    ],
                }
            },
        }
        r = refusal(answer, {"flux.safetensors"})
        text = json.dumps(r)
        self.assertNotIn("my_private_model", text)
        self.assertNotIn("another.ckpt", text)
        self.assertEqual(r["node_errors"]["4"]["class_type"], "CheckpointLoaderSimple")
        err = r["node_errors"]["4"]["errors"][0]
        self.assertIn("not in list", err["message"])
        self.assertEqual(err["extra_info"], {"input_name": "ckpt_name", "received_value": "flux.safetensors"})
        # A value the graph didn't send isn't echoed.
        self.assertNotIn("received_value", refusal(answer, {"other"})["node_errors"]["4"]["errors"][0]["extra_info"])
        missing = refusal({"error": {"type": "missing_node_type", "message": "Node 'Foo' not found. The custom node may not be installed.", "extra_info": {"class_type": "Foo", "node_id": "3"}}})
        self.assertEqual(missing["error"]["extra_info"], {"class_type": "Foo"})


class PackageTest(unittest.TestCase):
    def test_one_version(self):
        with open(os.path.join(PACK, "pyproject.toml"), encoding="utf-8") as f:
            text = f.read()
        self.assertEqual(re.search(r'^version = "([^"]+)"', text, re.M).group(1), __version__)

    def test_registry_metadata(self):
        with open(os.path.join(PACK, "pyproject.toml"), encoding="utf-8") as f:
            text = f.read()
        name = re.search(r'^name = "([^"]+)"', text, re.M).group(1)
        self.assertNotIn("comfyui", name.lower())
        self.assertNotRegex(text, r'Icon = ""')
        self.assertIn("requires-python", text)
        self.assertIn("requires-comfyui", text)
        with open(os.path.join(PACK, ".comfyignore"), encoding="utf-8") as f:
            ignored = f.read().split()
        self.assertIn("tests/", ignored)


if __name__ == "__main__":
    unittest.main()
