/**
 * Model settings whose value runs on a visitor's own setup only, by the own-setup.ts id each value is asked by (the
 * server asks the same ids of a run: src/server/pool-own-setup.ts requestSetupIds). A picker shows that id's label
 * beside the value.
 */
export function controlSetup(modelId: string | undefined, param: string, value: string | number): string | undefined {
  // Kandinsky 6.0 (open) at Pro quality.
  if (modelId === "oss-kandinsky6" && param === "quality" && value === "pro") return "oss-kandinsky6:pro";
  return undefined;
}
