import { apiClient, handleApi } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/** The property the key belongs to: name, currency, timezone, business date. */
export async function GET(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  return handleApi(request, params, async ({ propertyId, key }) => {
    const { data, error } = await apiClient().rpc("api_property", { p_property_id: propertyId, p_key: key });
    return { data: data?.[0] ?? null, error };
  });
}
