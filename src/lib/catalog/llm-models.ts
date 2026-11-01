import type { ModelDef, ModelRoute, Operation } from "./types";

/**
 * Text steps (translate, write) run on the LLM this install is set up with, inside the Fuobe
 * server (src/server/providers/llm.ts). Kind "text": they only show up where a studio asks for
 * text models (dubbing, scripts, ad copy) and in pipelines, never in the image/video/audio pickers.
 * The route endpoint says which LLMs a model may use: "auto" = Claude when an Anthropic key is
 * set, else a local model; "ollama" = a local model only, whichever server runs it (Ollama, LM Studio,
 * Unsloth Studio or another OpenAI-compatible one; the id predates them): open-source installs never
 * call a paid API, and its translations run on ComfyUI's Qwen3.5 4B workflow when no local model answers.
 */

const llm = (op: Operation, endpoint: "auto" | "ollama"): ModelRoute => ({ op, provider: "llm", endpoint });

/** Languages offered in the translate picker (any language name works). */
export const LLM_LANGUAGES = [
  "English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch", "Polish", "Russian", "Turkish", "Arabic", "Hebrew",
  "Hindi", "Bengali", "Japanese", "Korean", "Chinese (Simplified)", "Chinese (Traditional)", "Indonesian", "Vietnamese", "Thai",
  "Swedish", "Danish", "Norwegian", "Finnish", "Greek", "Czech", "Ukrainian", "Romanian", "Hungarian", "Swahili", "Tagalog",
];

export const LLM_MODELS: ModelDef[] = [
  {
    id: "text-llm",
    name: "Claude",
    vendor: "Anthropic",
    family: "llm",
    engine: "cloud",
    kind: "text",
    tagline: "Translates subtitles cue by cue and writes scripts, captions and ad copy (a local model when no Anthropic key is set)",
    badges: ["top"],
    routes: [llm("translate", "auto"), llm("write", "auto")],
    options: { languages: LLM_LANGUAGES },
    // Claude Opus 5.5 at $4 / $20 per million tokens: a few cents for a page of text.
    pricing: { unit: "request", usd: 0.02, note: "≈ a page of text; free when it runs on a local model" },
  },
  {
    id: "oss-text-llm",
    name: "Local LLM",
    vendor: "Ollama · LM Studio · Unsloth",
    family: "llm",
    engine: "open",
    kind: "text",
    tagline: "Translation and writing on your own machine with Ollama, LM Studio or Unsloth Studio (qwen3, llama, gemma, mistral…); without one, translations run on ComfyUI (Qwen3.5 4B)",
    badges: ["open"],
    routes: [llm("translate", "ollama"), llm("write", "ollama")],
    options: { languages: LLM_LANGUAGES },
  },
];
