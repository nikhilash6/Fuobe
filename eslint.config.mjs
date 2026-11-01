import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Agent worktrees and local data live inside the checkout but aren't part of it.
    ".claude/**",
    "data/**",
    // The evaluation harness's metrics venv, run results and your own inputs (all git-ignored).
    "scripts/eval/metrics/.venv/**",
    "scripts/eval/results/**",
    "scripts/eval/local/**",
    // The build workflow's body: a fragment (top-level await and return) that docs/handoff/make-workflow.mjs completes.
    "docs/handoff/workflow.body.js",
  ]),
]);

export default eslintConfig;
