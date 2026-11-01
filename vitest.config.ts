import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Local LLM servers on this machine (LM Studio on :1234, Unsloth Studio on :8888) stay out of the
    // tests: Automatic would find them. Tests that need one start a stand-in and point Settings at it.
    // Hosted LLM keys from this machine's environment stay out too, so no test reaches a real provider: tests that need
    // one set a key in Settings and point the provider at a stand-in (FUOBE_LLM_TEST_BASE).
    env: {
      LMSTUDIO_URL: "http://127.0.0.1:9",
      UNSLOTH_URL: "http://127.0.0.1:9",
      ...Object.fromEntries(
        [
          "OPENAI_API_KEY",
          "GEMINI_API_KEY",
          "XAI_API_KEY",
          "FUOBE_META_API_KEY",
          "MISTRAL_API_KEY",
          "CO_API_KEY",
          "COHERE_API_KEY",
          "DEEPSEEK_API_KEY",
          "MOONSHOT_API_KEY",
          "ZAI_API_KEY",
          "ZHIPUAI_API_KEY",
          "DASHSCOPE_API_KEY",
          "MINIMAX_API_KEY",
          "OPENROUTER_API_KEY",
          "GROQ_API_KEY",
          "CEREBRAS_API_KEY",
          "TOGETHER_API_KEY",
          "FIREWORKS_API_KEY",
          "FUOBE_HF_TOKEN",
          "FUOBE_LLM_TEST_BASE",
        ].map((k) => [k, ""]),
      ),
    },
  },
});
