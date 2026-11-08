import { describe, expect, it } from "vitest";
import { entryReason, executionReason, graphTexts, reasonText, REASON_MAX, refusalReason, withoutKeys } from "@/lib/comfy-reason";

/**
 * ComfyUI's own reason a job failed, as one short line for the owner: its /prompt refusal (`error` and `node_errors`) and
 * its execution error, with the run's words, keys, tokens and folders taken out.
 */

const PROMPT = "a fashion model in a red silk gown on a rooftop at golden hour";
const GRAPH = {
  "3": { class_type: "KSampler", inputs: { seed: 1, sampler_name: "euler" } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: PROMPT } },
  "12": { class_type: "InstantHMRLoader", inputs: { model_name: "detection/instanthmr_medium.safetensors" } },
};

describe("refusals (/prompt answered 400)", () => {
  it("a node type that isn't installed", () => {
    const body = {
      error: {
        type: "missing_node_type",
        message: "Node 'Predict' not found. The custom node may not be installed.",
        details: "Node ID '#12'",
        extra_info: { node_id: "12", class_type: "InstantHMRPredict", node_title: "Predict" },
      },
      node_errors: {},
    };
    expect(refusalReason(body)).toBe("ComfyUI refused the job: node InstantHMRPredict (id 12) isn't installed");
  });

  it("a model file not in the list: its name, never the whole list", () => {
    const body = {
      error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation", details: "", extra_info: {} },
      node_errors: {
        "12": {
          class_type: "InstantHMRLoader",
          dependent_outputs: ["40"],
          errors: [
            {
              type: "value_not_in_list",
              message: "Value not in list",
              details: "model_name: 'detection/instanthmr_medium.safetensors' not in ['other_a.safetensors', 'other_b.safetensors']",
              extra_info: { input_name: "model_name", input_config: [["other_a.safetensors", "other_b.safetensors"]], received_value: "detection/instanthmr_medium.safetensors" },
            },
          ],
        },
      },
    };
    const why = refusalReason(body)!;
    expect(why).toBe("ComfyUI refused the job: model file detection/instanthmr_medium.safetensors not in the list (model_name of InstantHMRLoader, id 12)");
    expect(why).not.toContain("other_a");
  });

  it("a required input missing, an option not in its list, a value out of range; at most three, then how many more", () => {
    const err = (type: string, extra: Record<string, unknown>, message = "x") => ({ type, message, details: String(extra.input_name ?? ""), extra_info: extra });
    const body = {
      error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
      node_errors: {
        "3": { class_type: "KSampler", errors: [err("required_input_missing", { input_name: "model" }, "Required input is missing"), err("value_not_in_list", { input_name: "sampler_name", received_value: "eulerx" })] },
        "4": { class_type: "EmptyLatentImage", errors: [err("value_bigger_than_max", { input_name: "width", received_value: 99999 }, "Value 99999 bigger than max of 16384")] },
        "5": { class_type: "VAEDecode", errors: [err("required_input_missing", { input_name: "vae" }, "Required input is missing")] },
      },
    };
    expect(refusalReason(body)).toBe(
      "ComfyUI refused the job: required input model missing (KSampler id 3); value eulerx for sampler_name not in the list (KSampler id 3); Value 99999 bigger than max of 16384 for width (EmptyLatentImage id 4) (+1 more)",
    );
  });

  it("a node's class from the graph when the answer leaves it out", () => {
    const body = { node_errors: { "12": { errors: [{ type: "required_input_missing", message: "Required input is missing", details: "image", extra_info: { input_name: "image" } }] } } };
    expect(refusalReason(body, { graph: GRAPH })).toBe("ComfyUI refused the job: required input image missing (InstantHMRLoader id 12)");
  });

  it("an answer that says nothing gives nothing", () => {
    expect(refusalReason({})).toBeNull();
    expect(refusalReason(null)).toBeNull();
    expect(refusalReason("nope")).toBeNull();
  });

  it("a value that holds the run's words is never named", () => {
    const body = {
      node_errors: {
        "6": { class_type: "CLIPTextEncode", errors: [{ type: "exception_during_validation", message: "Exception when validating node", details: `bad text: ${PROMPT}`, extra_info: { input_name: "text", received_value: PROMPT } }] },
      },
    };
    const why = refusalReason(body, { graph: GRAPH })!;
    expect(why).toContain("CLIPTextEncode id 6");
    expect(why).not.toContain("silk gown");
    expect(why).not.toContain("rooftop");
  });
});

describe("execution errors (/history or the websocket)", () => {
  const traceback = [
    '  File "X:\\fuobe-worker\\ComfyUI\\execution.py", line 496, in execute\n    output_data, output_ui, has_subgraph = await get_output_data(...)\n',
    '  File "X:\\fuobe-worker\\ComfyUI\\nodes.py", line 1525, in sample\n    return common_ksampler(model, seed, steps)\n',
    '  File "/home/runner/ComfyUI/comfy/samplers.py", line 88, in apply_model\n    x = self.inner(x)\n',
  ];

  it("running out of memory: the node, in a few words", () => {
    const data = { node_id: "7", node_type: "KSampler", exception_type: "torch.OutOfMemoryError", exception_message: "CUDA out of memory. Tried to allocate 2.00 GiB. GPU 0 has a total capacity of 31.84 GiB", traceback };
    expect(executionReason(data)).toBe("CUDA out of memory in KSampler (node 7)");
  });

  it("another exception: its type, its first line, and the last frames by file name only", () => {
    const data = { node_id: "7", node_type: "KSampler", exception_type: "RuntimeError", exception_message: "mat1 and mat2 shapes cannot be multiplied (77x2048 and 4096x3072)\nmore lines", traceback };
    const why = executionReason(data)!;
    expect(why).toBe("RuntimeError in KSampler (node 7): mat1 and mat2 shapes cannot be multiplied (77x2048 and 4096x3072) (at nodes.py:1525 sample < samplers.py:88 apply_model)");
    expect(why).not.toMatch(/fuobe-worker|X:\\|\/home\//);
  });

  it("a history entry: its execution error, an interrupt, or only its status", () => {
    const entry = (messages: unknown[]) => ({ status: { status_str: "error", completed: false, messages } });
    expect(entryReason(entry([["execution_start", {}], ["execution_error", { node_id: "5", node_type: "VHS_LoadVideo", exception_type: "Exception", exception_message: "VHS failed to extract audio" }]]))).toBe(
      "Exception in VHS_LoadVideo (node 5): VHS failed to extract audio",
    );
    expect(entryReason(entry([["execution_interrupted", { node_id: "3", node_type: "KSampler" }]]))).toBe("ComfyUI stopped the job (interrupted) in KSampler (node 3)");
    expect(entryReason(entry([]))).toBe("ComfyUI ended the job with an error");
    expect(entryReason({ status: { status_str: "success", messages: [] } })).toBeNull();
  });
});

describe("what a reason never holds", () => {
  it("keys and tokens", () => {
    const raw = "failed with hf_abcdefghijklmnopqrstu and sk-abcdefghijklmnop12 Bearer eyJhbGciOi.payload.sig token=abc123secret 123456789:AAEhBP0av28aBcDeFgHiJkLmNoPqRsTuVwX https://x.test/a?key=zzz&b=1 AbCdEf0123456789AbCdEf0123456789xyz";
    const out = withoutKeys(raw);
    for (const leak of ["hf_abc", "sk-abc", "eyJhbG", "abc123secret", "AAEhBP0", "key=zzz", "AbCdEf0123456789"]) expect(out).not.toContain(leak);
    expect(out).toContain("b=1");
  });

  it("model file names stay, however long", () => {
    const name = "diffusion_models/qwen_image_2512_fp8_e4m3fn_scaled_comfyui_4steps_v1.safetensors";
    expect(withoutKeys(`missing ${name}`)).toBe(`missing ${name}`);
  });

  it("folders, addresses and the run's words; and it is cut short", () => {
    const out = reasonText(`Error loading C:\\Users\\owner\\models\\x.safetensors from http://127.0.0.1:8188/view for ${PROMPT}`, { graph: GRAPH });
    expect(out).toBe("Error loading x.safetensors from [address] for [text]");
    expect(reasonText("x".repeat(5000)).length).toBeLessThanOrEqual(REASON_MAX);
  });

  it("the run's words: each text with a space, never a file name or an option", () => {
    expect(graphTexts({ ...GRAPH, "9": { class_type: "LoadImage", inputs: { image: "my photo.png" } } })).toEqual([PROMPT]);
  });
});
