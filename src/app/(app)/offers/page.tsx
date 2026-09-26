import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui";
import { PromotionsScreen } from "@/components/promotions/promotions-screen";
import {
  getCurrentStaffUser,
  getPromotions,
  getRatePlans,
  getRoomTypes,
} from "@/lib/queries";

export const metadata = { title: "Offers" };

export default async function OffersPage() {
  const tr = await getT();
  const [promotions, ratePlans, roomTypes, staff] = await Promise.all([
    getPromotions(),
    getRatePlans(),
    getRoomTypes(),
    getCurrentStaffUser(),
  ]);

  return (
    <div>
      <PageHeader
        title={tr("Offers")}
      />
      <PromotionsScreen
        promotions={promotions}
        ratePlans={ratePlans}
        roomTypes={roomTypes}
        canEdit={staff !== null && ["admin", "manager"].includes(staff.role)}
      />
    </div>
  );
}
