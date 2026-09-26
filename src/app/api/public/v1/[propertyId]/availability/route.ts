import { apiClient, dateParam, handleApi } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/** `?from=YYYY-MM-DD&to=YYYY-MM-DD`: nights, inclusive, at most 366. */
export async function GET(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  return handleApi(request, params, ({ propertyId, key, url }) =>
    apiClient()
      .rpc("api_availability", {
        p_property_id: propertyId,
        p_key: key,
        p_from: dateParam(url, "from"),
        p_to: dateParam(url, "to"),
      }),
  );
}
