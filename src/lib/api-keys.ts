/**
 * What a developer key may read from the public API (0101): one permission
 * per endpoint, named for its path. The API Key has all of them. The same
 * list is the `api_keys.permissions` check in Postgres; they change together.
 */
export const API_PERMISSIONS = [
  { id: "room_types", path: "room-types" },
  { id: "rate_plans", path: "rate-plans" },
  { id: "availability", path: "availability" },
  { id: "rates", path: "rates" },
] as const;

export type ApiPermission = (typeof API_PERMISSIONS)[number]["id"];
