// next/server for the studio's code run outside Next (tests/helpers/app-process-child.ts), as the tests mock it:
// connection() has no request to wait for, so it resolves at once. Everything else is Next's own.
export * from "next/server.js";
export const connection = async (): Promise<void> => {};
