/**
 * Hosted runs (FUOBE_HOSTED_RUNS=1, docs/public-signup.md "Hosted runs"): accounts with no GPU of their own may run on
 * this install's GPUs. Off unless set. Read from the environment only, so the sign-in proxy can read it too.
 */
export const hostedRunsOn = (): boolean => process.env.FUOBE_HOSTED_RUNS === "1";
