import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/lib/supabase/database";

/**
 * Retries a request Supabase turned away without running it.
 *
 * A page like Settings makes forty-odd reads at once, and every one throws
 * on error, so a single refusal takes the whole page down ("Application
 * error ... Digest"). The hosted gateway occasionally rejects a perfectly
 * good token -- seen 8 Oct: 80 requests on one fresh token succeeded and one
 * came back 401 PGRST303 in the middle of them -- and a refresh of the page
 * always worked. So:
 *
 * - **401 PGRST301/PGRST303 (the JWT was not accepted)**: nothing ran, so any
 *   method is retried once, a write included.
 * - **A network failure, 502, 503 or 504**: retried once for GET and HEAD
 *   only. A POST may have run before the connection dropped, and an RPC that
 *   posts money must never run twice.
 */
async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const idempotent = method === "GET" || method === "HEAD";

  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    if (!idempotent) throw error;
    await pause();
    return fetch(input, init);
  }

  if (response.status === 401 && (await rejectedToken(response))) {
    await pause();
    return fetch(input, init);
  }
  if (idempotent && (response.status === 502 || response.status === 503 || response.status === 504)) {
    await pause();
    return fetch(input, init);
  }
  return response;
}

async function rejectedToken(response: Response): Promise<boolean> {
  try {
    const body = await response.clone().json();
    return body?.code === "PGRST301" || body?.code === "PGRST303";
  } catch {
    return false;
  }
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, 150));
}

/**
 * One client per request, not one per read. Each client manages the session
 * on its own, so forty separate clients on a page meant up to forty token
 * refreshes when the session was near expiry -- Auth answered some with 429,
 * and saw several refreshes for one page load. A shared client single-flights
 * the refresh. Outside a render (a Server Action) `cache` does not memoise,
 * which is the old behaviour.
 */
export const createClient = cache(async () => {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { fetch: fetchWithRetry },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always write cookies.
            // Middleware handles session refresh.
          }
        },
      },
    },
  );
});
