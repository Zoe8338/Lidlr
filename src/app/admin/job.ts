import type { AdminJobStatus } from "./actions";

const g = globalThis as unknown as { __lidlrAdminJob?: AdminJobStatus | null };

export function readJobStatus(): AdminJobStatus | null {
  return g.__lidlrAdminJob ?? null;
}
