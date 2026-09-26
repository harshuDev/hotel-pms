import { apiClient, handleApi } from "@/lib/public-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ propertyId: string }> }) {
  return handleApi(request, params, ({ propertyId, key }) =>
    apiClient().rpc("api_rate_plans", { p_property_id: propertyId, p_key: key }),
  );
}
