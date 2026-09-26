/**
 * Settings -> Connectivity Settings -> Key Lock Systems (0102) and
 * Housekeeping Systems (0103): one table, `system_connections`, one panel,
 * two provider lists. STORED, NOT YET CONNECTED: nothing talks to a lock or
 * to a housekeeping system. The secret is write-only, in Supabase Vault; a
 * connection only says whether one is saved.
 *
 * THE FIELD LABELS ARE PROVISIONAL -- the reference's forms were not seen --
 * and are the ordinary ones for each provider. The provider ids are also the
 * `system_connections_provider_check` constraint; they change together.
 */
export const SYSTEM_CATEGORIES = {
  key_lock: {
    title: "Key Lock Systems",
    providers: [
      { id: "flexipass", label: "Flexipass", account: "Account", secret: "API key" },
      { id: "remotelock", label: "Remotelock", account: "Client ID", secret: "Client secret" },
    ],
  },
  housekeeping: {
    title: "Housekeeping Systems",
    providers: [{ id: "sweeply", label: "Sweeply", account: "Property ID", secret: "API key" }],
  },
} as const;

export type SystemCategory = keyof typeof SYSTEM_CATEGORIES;

export type SystemProvider = {
  id: string;
  label: string;
  account: string;
  secret: string;
};

export function systemProvider(category: SystemCategory, id: string): SystemProvider {
  const list: readonly SystemProvider[] = SYSTEM_CATEGORIES[category].providers;
  return list.find((p) => p.id === id) ?? list[0];
}

export interface SystemConnection {
  id: string;
  provider: string;
  name: string;
  isActive: boolean;
  accountId: string | null;
  /** Whether a secret is saved. The secret itself never leaves the vault. */
  hasSecret: boolean;
}
