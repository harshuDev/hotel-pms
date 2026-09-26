/**
 * Settings -> Connectivity Settings -> Channel Manager (0097). STORED, NOT
 * YET CONNECTED: nothing talks to SiteMinder or Vertical Booking yet.
 *
 * The password is write-only: it goes to Supabase Vault through
 * `save_channel_manager()` and no read in this application returns it. A
 * connection only says whether one is saved.
 *
 * `REGIONS` is PROVISIONAL (the reference's dropdown was not seen open), and
 * `DAYS_TO_SYNC` holds the reference's 400 among ordinary choices. Both are
 * also listed in the 0097 check constraints and change together.
 */

export const CHANNEL_MANAGERS = [
  { id: "site_minder", label: "Site Minder" },
  { id: "vertical_booking", label: "Vertical Booking" },
] as const;

export type ChannelManagerProvider = (typeof CHANNEL_MANAGERS)[number]["id"];

export function channelManagerLabel(id: string): string {
  return CHANNEL_MANAGERS.find((c) => c.id === id)?.label ?? id;
}

export const REGIONS = [
  { id: "emea", label: "Europe, Middle East & Africa" },
  { id: "apac", label: "Asia Pacific" },
  { id: "americas", label: "Americas" },
] as const;

export const DAYS_TO_SYNC = [90, 180, 365, 400, 500, 730] as const;

/** The largest configuration file Postgres accepts, in characters. */
export const MAX_CONFIG_CHARS = 262144;

export interface ChannelManager {
  id: string;
  provider: ChannelManagerProvider;
  connectionName: string;
  isActive: boolean;
  username: string | null;
  /** Whether a password is saved. The password itself never leaves the vault. */
  hasPassword: boolean;
  hotelCode: string | null;
  requestorId: string | null;
  region: string | null;
  daysToSync: number;
  syncMultiOccupancy: boolean;
  roomConfigName: string | null;
  rateConfigName: string | null;
  isSynced: boolean;
  syncedAt: string | null;
}
