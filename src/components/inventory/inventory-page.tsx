import { isValid, parseISO } from "date-fns";
import { PageHeader } from "@/components/ui";
import { InventoryScreen } from "@/components/inventory/inventory-screen";
import { SCREENS } from "@/components/inventory/field-spec";
import {
  INVENTORY_NIGHTS,
  getBusinessDate,
  getCurrentStaffUser,
  getInventoryGrid,
  getRatePlans,
} from "@/lib/queries";
import type { InventoryField } from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every Inventory route is this page with a different field.
 *
 * Nine separate screens would be nine places to get the same grid subtly
 * different, and the client asked for nine entries in a menu, not nine
 * different ways of looking at a calendar.
 */
export async function InventoryPage({
  fieldName,
  searchParams,
}: {
  fieldName: InventoryField;
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  const spec = SCREENS[fieldName];
  const sp = await searchParams;

  const [staff, businessDate, plans] = await Promise.all([
    getCurrentStaffUser(),
    getBusinessDate(),
    getRatePlans(),
  ]);

  const from =
    sp.from && ISO_DATE.test(sp.from) && isValid(parseISO(sp.from))
      ? sp.from
      : businessDate;

  // The named plan, else the default, else the first. Null is fine for the two
  // screens that set the room type itself.
  const planId =
    (sp.plan && plans.some((p) => p.id === sp.plan) ? sp.plan : null) ??
    plans.find((p) => p.isDefault)?.id ??
    plans[0]?.id ??
    null;

  const cells = await getInventoryGrid(
    spec.needsPlan ? planId : null,
    from,
    INVENTORY_NIGHTS,
  );

  return (
    <div>
      <PageHeader title={spec.title} subtitle={spec.subtitle} />
      <InventoryScreen
        fieldName={fieldName}
        plans={plans}
        planId={planId}
        from={from}
        cells={cells}
        nights={INVENTORY_NIGHTS}
        canEdit={
          staff !== null && ["admin", "manager"].includes(staff.role)
        }
      />
    </div>
  );
}
