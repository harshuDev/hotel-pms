import { readAll } from "@/lib/supabase/read-all";
import { apiClient, dateParam, handleApi } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD`: nights, inclusive, at most 366. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ propertyId: string }> },
) {
  // A year of nights x every room type is far past the 1,000-row page, so it
  // is read in pages, by room type code (unique) then night.
  return handleApi(request, params, ({ propertyId, key, url }) =>
    readAll((a, b) =>
      apiClient()
        .rpc("api_availability", {
          p_property_id: propertyId,
          p_key: key,
          p_from: dateParam(url, "from"),
          p_to: dateParam(url, "to"),
        })
        .order("room_type_code")
        .order("stay_date")
        .range(a, b),
    ),
  );
}
