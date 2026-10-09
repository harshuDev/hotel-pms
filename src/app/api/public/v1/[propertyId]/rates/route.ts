import { readAll } from "@/lib/supabase/read-all";
import { apiClient, dateParam, handleApi, idParam } from "@/lib/public-api";
import { nullableArg } from "@/lib/supabase/database";

export const dynamic = "force-dynamic";

/** `?from=&to=` and optionally `&rate_plan=<id>`; without one, the hotel's default plan. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  // A year of nights x every room type is far past the 1,000-row page, so it
  // is read in pages, by room type code (unique) then night.
  return handleApi(request, params, ({ propertyId, key, url }) =>
    readAll((a, b) =>
      apiClient()
        .rpc("api_rates", {
          p_property_id: propertyId,
          p_key: key,
          // Null is the hotel's default rate plan.
          p_rate_plan_id: nullableArg(idParam(url, "rate_plan")),
          p_from: dateParam(url, "from"),
          p_to: dateParam(url, "to"),
        })
        .order("room_type_code")
        .order("stay_date")
        .range(a, b),
    ),
  );
}
