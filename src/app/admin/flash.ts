// Tiny one-shot flash message store for admin server actions: the action sets
// a result message and the next render of /admin shows it. Kept on globalThis
// so it survives module reloads in dev.
export type AdminFlash = { ok: boolean; message: string; at: string } | null;

const g = globalThis as unknown as { __lidlrAdminFlash?: AdminFlash };

export function setFlash(message: string, ok = true): void {
  g.__lidlrAdminFlash = { ok, message, at: new Date().toISOString() };
}

export function readFlash(): AdminFlash {
  return g.__lidlrAdminFlash ?? null;
}

export function clearFlash(): void {
  g.__lidlrAdminFlash = null;
}
