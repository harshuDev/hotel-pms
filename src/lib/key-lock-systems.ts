/**
 * Settings -> Connectivity Settings -> Key Lock Systems (0102). STORED, NOT
 * YET CONNECTED: nothing talks to a lock. The secret is write-only, in
 * Supabase Vault; a connection only says whether one is saved.
 *
 * THE FIELD LABELS ARE PROVISIONAL -- the reference's forms were not seen --
 * and are the ordinary ones for each provider. They change here and nowhere
 * else; the columns are the same for both.
 */
export const KEY_LOCK_PROVIDERS = [
  { id: "flexipass", label: "Flexipass", account: "Account", secret: "API key" },
  { id: "remotelock", label: "Remotelock", account: "Client ID", secret: "Client secret" },
] as const;

export type KeyLockProvider = (typeof KEY_LOCK_PROVIDERS)[number]["id"];

export function keyLockProvider(id: string) {
  return KEY_LOCK_PROVIDERS.find((p) => p.id === id) ?? KEY_LOCK_PROVIDERS[0];
}

export interface KeyLockSystem {
  id: string;
  provider: KeyLockProvider;
  name: string;
  isActive: boolean;
  accountId: string | null;
  /** Whether a secret is saved. The secret itself never leaves the vault. */
  hasSecret: boolean;
}
