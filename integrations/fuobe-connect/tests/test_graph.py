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
    FILE_LOADERS,
    LINK_INPUTS,
    OPTIONAL_FILES,
    OWN_NODES_FILE,
    PATH_INPUTS,
    TEXT_INPUTS,
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
            "/",
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

    def test_every_absolute_form(self):
        """Every way Windows, Linux and macOS read a text as a place outside a node's own folder."""
        for v in [
            "//?/C:/Users/Public/x.srt",  # a Win32 device path with forward slashes
            "//attacker.example/share/x.srt",  # a network share with forward slashes
            B + B + "?" + B + "C:" + B + "x",  # \\?\C:\x
            B + B + "." + B + "PhysicalDrive0",  # \\.\PhysicalDrive0
            B + "Users" + B + "Public" + B + "x.srt",  # \Users\...: the root of ComfyUI's drive
            B + "/attacker.example/share/x.srt",  # \/host/share: a share too
            "D:Users" + B + "x.srt",  # a drive with no slash: that drive's own working folder
            "C:x.srt",
            "C:",
            "~",
            "~admin/Videos/x.mp4",  # another account's home
            "~admin",
            "$HOME/x",
            "${HOME}/x",
            "$HOME",
            "%USERPROFILE%" + B + "x",
            "%APPDATA%",
            # What a node that trims its text sees.
            " C:/Users/me",
            "\t/etc/passwd",
            "\u3000" + B + "Users",
            '"C:/Users/me"',
            "'//host/share'",
            ' " ~/x',
        ]:
            self.assertEqual(vet_graph(g(node("CLIPTextEncode", text=v)), NODES, STAGED), "unsafe-path", repr(v))
        # Words that start like one but aren't: a dialogue line, a mood, a price, a share of something.
        for v in ["A: hello there", "B:\tok", "~ dreamy ~", "$5 bill", "$HOME is where the heart is", "50% off", "%d frames", "SPEAKER A: Test"]:
            self.assertIsNone(vet_graph(g(node("CLIPTextEncode", text=v)), NODES, STAGED), repr(v))

    def test_a_place_inside_json(self):
        """A plan or a settings text that a node parses: no key that names a file, a folder or an address."""
        for v in [
            '{"shots": [{"id": "a", "lip_sync_source_asset": {"path": "x.wav"}}]}',
            '{"video_path": "clip.mp4"}',
            "{'output_folder': 'x'}",
            '{"model_root": "models"}',
            '{"config_file": "a.yaml"}',
            '{"url": "x"}',
            '{"src": "x"}',
            '{"FileName": "x"}',
        ]:
            self.assertEqual(vet_graph(g(node("CLIPTextEncode", text=v)), NODES, STAGED), "unsafe-path", v)
        # The JSON Fuobe's own graphs send: a lean picture prompt, boxes, a plan, touches.
        for v in [
            '{"high_level_description": "a red door", "elements": [{"type": "photo", "desc": "x", "bbox": [0, 0, 1, 1]}], "color_palette": ["#fff"]}',
            '{"coordinate_space": "pixels", "boxes": []}',
            '{"shots": [{"id": "intro", "prompt": "Describe the opening"}]}',
            '{"items": [{"op": "add", "x": 1, "y": 2, "t": 0}]}',
            "Profile: a file of notes, a folder of pictures",
        ]:
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
        """Every workflow Fuobe ships passes every check once its loaders name the files the studio sends (when the
        pack is inside Fuobe): only listed nodes, no path-like text, every rule above."""
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
            self.assertIsNone(vet_graph(staged_like_the_studio(wf), nodes, None), os.path.basename(f))
        self.assertGreater(checked, 50)


def staged_like_the_studio(wf: dict) -> dict:
    """The workflow as the studio sends it: each loader's placeholder file becomes a Fuobe input name, and a 2K finish
    loads its own draft's latent (src/lib/catalog/regenerate.ts latentFileFor)."""
    wf = json.loads(json.dumps(wf))
    count = [0]

    def staged(v):
        if not isinstance(v, str) or not v or staged_name_ok(v):
            return v
        count[0] += 1
        ext = v.rsplit(".", 1)[1].lower() if "." in v else "png"
        return f"fuobe_placeholder{count[0]:04d}.{ext}"

    for n in wf.values():
        inputs = n.get("inputs") or {}
        for k in FILE_LOADERS.get(n["class_type"], []) + OPTIONAL_FILES.get(n["class_type"], []):
            inputs[k] = staged(inputs.get(k))
        if n["class_type"] == "OpenH3LoadRefinedLatent":
            inputs["latent_file"] = "fuobe_h3_gen123abc_00001.safetensors"
        if n["class_type"] == "Load3D" and isinstance(inputs.get("image"), dict):
            for k, v in inputs["image"].items():
                if k != "camera_info":
                    inputs["image"][k] = staged(v)
    return wf


SHIPPED = shipped_nodes()


def vet1(cls, staged=STAGED, **inputs):
    """One node of the shipped list, with these inputs."""
    return vet_graph(g(node(cls, **inputs)), SHIPPED, staged)


class NodeRulesTest(unittest.TestCase):
    """Inputs that a listed node reads as a file or a folder take only Fuobe's own form, and never a link."""

    def test_rules_name_shipped_nodes(self):
        for table in (PATH_INPUTS, LINK_INPUTS, TEXT_INPUTS, OPTIONAL_FILES):
            for cls in table:
                self.assertIn(cls, SHIPPED, cls)
        self.assertIn("Hi3DLoadMesh", FILE_LOADERS)

    def test_subtitle_file(self):
        """AILab_Qwen3ASRSubtitle writes its file at output_path (an absolute path as given)."""
        for ok in ["", "fuobe/captions", "fuobe/gen123/captions"]:
            self.assertIsNone(vet1("AILab_Qwen3ASRSubtitle", output_path=ok, audio=["9", 0]), ok)
        for bad in [
            "//?/C:/Users/Public/x.srt",
            "//attacker.example/share/x.srt",
            B + "Users" + B + "Public" + B + "x.srt",
            B + "/attacker.example/share/x.srt",
            "D:Users" + B + "x.srt",
            "C:/Users/Public/x.srt",
            "captions",  # anywhere in your output folder
            "fuobe/x.bat",
            "fuobe/../x",
            "fuobe",
        ]:
            self.assertEqual(vet1("AILab_Qwen3ASRSubtitle", output_path=bad, audio=["9", 0]), "unsafe-path", repr(bad))
        # A path another node works out: never.
        self.assertEqual(vet_graph(g(node("PrimitiveStringMultiline", value="fuobe/captions"), node("AILab_Qwen3ASRSubtitle", output_path=["1", 0])), SHIPPED, STAGED), "unsafe-path")

    def test_source_timeline_reads_no_file(self):
        """MiniMaxH3SourceTimeline opens any file at video_path / audio_path: Fuobe's graphs leave them empty."""
        self.assertIsNone(vet1("MiniMaxH3SourceTimeline", video_path="", audio_path="", source_audio=["2", 0]))
        for bad in [
            B + "Users" + B + "me" + B + "Videos" + B + "private.mp4",
            "//?/D:/private/voice.wav",
            "ComfyUI/input/my_private.mp4",  # relative to ComfyUI's working folder: your own files
            "ComfyUI/output/ComfyUI_00001_.mp4",
            "~admin/Videos/x.mp4",
            "fuobe_abcdefgh12.png",
        ]:
            self.assertEqual(vet1("MiniMaxH3SourceTimeline", video_path=bad, audio_path=""), "unsafe-path", bad)
            self.assertEqual(vet1("MiniMaxH3SourceTimeline", video_path="", audio_path=bad), "unsafe-path", bad)
        self.assertEqual(vet_graph(g(node("StringConcatenate", string_a="C", string_b="x", delimiter=":"), node("MiniMaxH3SourceTimeline", video_path=["1", 0], audio_path="")), SHIPPED, STAGED), "unsafe-path")

    def test_model_paths(self):
        self.assertIsNone(vet1("AuKModelLoader", checkpoint_path="ckpts/AuK-Flash/auk_flash.safetensors", config_path="", qwen_path="ckpts/Qwen2.5-Omni-3B", device="cuda:0", dtype="bf16"))
        self.assertIsNone(vet1("AuKModelLoader", checkpoint_path="ckpts/AuK/auk_base.safetensors", config_path="", qwen_path=""))
        for bad in [
            {"checkpoint_path": "ckpts/../x.safetensors"},
            {"checkpoint_path": "ckpts/AuK/x.ckpt"},
            {"checkpoint_path": "input/fuobe_abcdefgh12.safetensors"},
            {"config_path": "ckpts/AuK/config.yaml"},
            {"qwen_path": "models"},
            {"qwen_path": "ckpts/.hidden"},
        ]:
            inputs = {"checkpoint_path": "ckpts/AuK/auk_base.safetensors", "config_path": "", "qwen_path": "", **bad}
            self.assertEqual(vet1("AuKModelLoader", **inputs), "unsafe-path", bad)
        self.assertIsNone(vet1("Hi3DModelLoader", model_root="", attention="sdpa"))
        self.assertEqual(vet1("Hi3DModelLoader", model_root="models"), "unsafe-path")
        self.assertIsNone(vet1("QWMRefineMask", sam_model="sam_vit_b_01ec64.pth", boxes_json=["2", 0]))
        for bad in ["input/fuobe_vit_b_12345678.bin", "fuobe_vit_b_12345678.bin", "sam_vit_b.bin", "x/sam_vit_b_01ec64.pth"]:
            self.assertEqual(vet1("QWMRefineMask", sam_model=bad), "unsafe-path", bad)
        self.assertIsNone(vet1("ZenImage21AdapterLoader", model_folder="", adapter_file="models/text_encoders/adapter_v12.safetensors", text_encoder="Qwen/Qwen3.5-0.8B"))
        self.assertIsNone(vet1("ZenImage21AdapterLoader", model_folder="", adapter_file="models/text_encoders/adapter_v12.safetensors", text_encoder="models/text_encoders/qwen3.5_0.8b"))
        for bad in [{"model_folder": "models"}, {"adapter_file": "input/fuobe_abcdefgh12.bin"}, {"text_encoder": "someone/other-model"}, {"text_encoder": "models/text_encoders/../x"}]:
            inputs = {"model_folder": "", "adapter_file": "models/text_encoders/adapter_v12.safetensors", "text_encoder": "Qwen/Qwen3.5-0.8B", **bad}
            self.assertEqual(vet1("ZenImage21AdapterLoader", **inputs), "unsafe-path", bad)

    def test_folders_a_node_writes(self):
        self.assertIsNone(vet1("WanVideoImageToVideoMultiTalk", output_path="", mode="infinitetalk"))
        self.assertEqual(vet1("WanVideoImageToVideoMultiTalk", output_path="frames"), "unsafe-path")
        self.assertIsNone(vet1("OpenH3LoadRefinedLatent", latent_file="fuobe_h3_gen123abc_00001.safetensors"))
        for bad in ["(newest)", "my_latent_00001.safetensors", "open_h3_regen_00001.safetensors"]:
            self.assertEqual(vet1("OpenH3LoadRefinedLatent", latent_file=bad), "unsafe-path", bad)

    def test_run_folder(self):
        """A Context Loop run's folder under output/h3_chains: a Fuobe job's own, or a swap plan's."""
        self.assertIsNone(vet1("MiniMaxH3ChainPlanModern", run_name="fuobe_abc123XYZ"))
        self.assertIsNone(vet1("MiniMaxH3ChainPlanModern", run_name="fuobe_job-x"))
        for bad in ["my_film", "fuobe_", "fuobe_a/b", "h3_chain"]:
            self.assertEqual(vet1("MiniMaxH3ChainPlanModern", run_name=bad), "unsafe-path", bad)
        plan = node("H3AdvancedSwapPlan", roles="")
        self.assertIsNone(vet_graph(g(plan, node("MiniMaxH3ChainPlanModern", run_name=["1", 3])), SHIPPED, STAGED))
        self.assertEqual(vet_graph(g(node("PrimitiveStringMultiline", value="my_film"), node("MiniMaxH3ChainPlanModern", run_name=["1", 0])), SHIPPED, STAGED), "unsafe-graph")

    def test_optional_history_file(self):
        self.assertIsNone(vet1("H3CharacterSwapShot", shot_id="character-swap"))
        self.assertIsNone(vet1("H3CharacterSwapShot", history_file=""))
        self.assertIsNone(vet1("H3CharacterSwapShot", history_file="fuobe_abcdefgh56.npz", staged=["fuobe_abcdefgh56.npz"]))
        for bad in ["history.npz", "fuobe_zzzzzzzz99.npz", ["2", 0]]:
            self.assertEqual(vet1("H3CharacterSwapShot", history_file=bad), "unsafe-graph", bad)

    def test_mesh_loader(self):
        self.assertIsNone(vet1("Hi3DLoadMesh", mesh_file="fuobe_abcdefgh34.glb", staged=["fuobe_abcdefgh34.glb"]))
        for bad in ["coarse.glb", "hi3d/mine.glb", ["2", 0]]:
            self.assertEqual(vet1("Hi3DLoadMesh", mesh_file=bad), "unsafe-graph", bad)

    def test_json_objects(self):
        """ComfyUI passes an object the graph writes to a node unchecked (a LoRA list, a model path, a {"__value__"})."""
        for bad in [
            node("WanVideoModelLoader", extra_model={"path": "models/x.safetensors"}),
            node("WanVideoModelLoader", lora={"__value__": [{"path": "loras/x.safetensors", "strength": 1}]}),
            node("WanVideoModelLoader", compile_args={"backend": "inductor"}),
            node("SaveGLB", mesh={"path": "x.glb"}),
        ]:
            self.assertEqual(vet_graph(g(bad), SHIPPED, STAGED), "unsafe-graph", bad)
        # A 3D view's entries are the one object a graph writes.
        self.assertIsNone(vet1("Save3DAdvanced", viewport_state={"image": "", "mask": "", "normal": "", "camera_info": {"position": {"x": 1, "y": 2, "z": 3}, "zoom": 1}}))
        self.assertEqual(vet1("Save3DAdvanced", viewport_state={"image": "C:/x.png"}), "unsafe-path")

    def test_svg_comes_from_the_vectorizer(self):
        vector = node("TS_ImageToSVGStringColor_Vtracer", image=["9", 0])
        self.assertIsNone(vet_graph(g(vector, node("TS_SVGStringToSVGBytesIO", SVG_String=["1", 0])), SHIPPED, STAGED))
        self.assertEqual(vet1("TS_SVGStringToSVGBytesIO", SVG_String="<svg onload='x()'/>"), "unsafe-graph")
        self.assertEqual(vet_graph(g(node("StringConcatenate", string_a="<svg", string_b="></svg>", delimiter=""), node("TS_SVGStringToSVGBytesIO", SVG_String=["1", 0])), SHIPPED, STAGED), "unsafe-graph")

    def test_format_reads_no_attribute(self):
        """Python's format reaches a module's globals through an object: "{a.__init__.__globals__[os].environ}"."""
        for ok in ["Dress {a} in image 1 in {b}. Keep the rest.", '{{"width": {a}, "height": {b}, "coords": "relative-1000"}}', "{a:.2f} and {b!r}", "{{a.b}}"]:
            self.assertIsNone(vet1("StringFormat", f_string=ok), ok)
        for bad in ["{a.__init__.__globals__[os].environ}", "{a[0]}", "x {b.real}", "{{{a.x}}}", "{a:{b.__class__}}", ["2", 0]]:
            self.assertEqual(vet1("StringFormat", f_string=bad), "unsafe-path", bad)


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
