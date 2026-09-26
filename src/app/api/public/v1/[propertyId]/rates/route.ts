import { apiClient, dateParam, handleApi, idParam } from "@/lib/public-api";
import { nullableArg } from "@/lib/supabase/database";

export const dynamic = "force-dynamic";

/** `?from=&to=` and optionally `&rate_plan=<id>`; without one, the hotel's default plan. */
export async function GET(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  return handleApi(request, params, ({ propertyId, key, url }) =>
    apiClient()
      .rpc("api_rates", {
        p_property_id: propertyId,
        p_key: key,
        // Null is the hotel's default rate plan.
        p_rate_plan_id: nullableArg(idParam(url, "rate_plan")),
        p_from: dateParam(url, "from"),
        p_to: dateParam(url, "to"),
      }),
  );
}
