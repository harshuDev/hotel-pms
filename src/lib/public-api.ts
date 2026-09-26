import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database";

/**
 * The read-only public API (0101): `/api/public/v1/<property>/...`.
 *
 * THE ONE PLACE THIS CODEBASE HAS API ROUTES besides external webhooks, by
 * the client's decision. Every route here is a thin pass-through:
 *
 *   - It reads the key from `Authorization: Bearer <key>` or `X-Api-Key`,
 *     NEVER from the query string -- a key in a URL ends up in every proxy
 *     and access log it passes.
 *   - It calls ONE `api_*` function as `anon`, with no session and no
 *     service-role key. That function checks the key and its permission in
 *     Postgres (`api_authorize()`) before it reads a row, so nothing here can
 *     widen what a key reaches.
 *   - It maps the function's SQLSTATE to HTTP: HA401 -> 401, HA403 -> 403,
 *     HA400 -> 400. Anything else is a 500 with no detail.
 *
 * Money is integer minor units (`rate_cents`) with the currency beside it --
 * nothing is formatted, which is the caller's job, not the API's.
 * There is no rate limiting yet; that belongs in front of the API.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A session-less client: whatever cookies a caller sends, the API runs as `anon`. */
export function apiClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
}

export function apiKeyFrom(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth && /^bearer\s+/i.test(auth)) return auth.replace(/^bearer\s+/i, "").trim() || null;
  return request.headers.get("x-api-key")?.trim() || null;
}

export function apiJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** A required YYYY-MM-DD query parameter. */
export function dateParam(url: URL, name: string): string {
  const v = url.searchParams.get(name);
  if (!v || !ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) {
    throw new ApiError(400, `${name} is required as a date (YYYY-MM-DD)`);
  }
  return v;
}

/** An optional id query parameter. */
export function idParam(url: URL, name: string): string | null {
  const v = url.searchParams.get(name);
  if (v === null || v === "") return null;
  if (!UUID.test(v)) throw new ApiError(400, `${name} is not a valid id`);
  return v;
}

type RpcError = { code?: string; message: string } | null;

/**
 * Runs one endpoint: checks the property id and the key are present, calls
 * the function, and turns its refusal into the right status.
 */
export async function handleApi(
  request: Request,
  params: Promise<{ propertyId: string }>,
  run: (ctx: { propertyId: string; key: string; url: URL }) => PromiseLike<{ data: unknown; error: RpcError }>,
): Promise<Response> {
  try {
    const { propertyId } = await params;
    const key = apiKeyFrom(request);
    // An unknown property and a bad key answer the same, so a stranger
    // cannot learn which property ids exist.
    if (!key || !UUID.test(propertyId)) return apiJson({ error: "Invalid or missing API key" }, 401);
    const { data, error } = await run({ propertyId, key, url: new URL(request.url) });
    if (error) {
      if (error.code === "HA401") return apiJson({ error: "Invalid or missing API key" }, 401);
      if (error.code === "HA403") return apiJson({ error: "This key does not have that permission" }, 403);
      if (error.code === "HA400") return apiJson({ error: error.message.replace(/^API_BAD_REQUEST:\s*/, "") }, 400);
      return apiJson({ error: "Something went wrong" }, 500);
    }
    return apiJson({ data });
  } catch (e) {
    if (e instanceof ApiError) return apiJson({ error: e.message }, e.status);
    return apiJson({ error: "Something went wrong" }, 500);
  }
}
