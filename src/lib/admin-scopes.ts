/**
 * The Settings preset for an admin token that only reads (docs/admin-api.md): runs' facts, reports, workers, the queue
 * and the admin log. No emails (accounts:read), no prompts and no results (outputs:view): those need their own scopes.
 * The token form ticks these and the server describes the preset with the same list.
 */
export const READ_ONLY_SCOPES = ["runs:read", "reports:read", "workers:read", "queue:read", "audit:read"] as const;
