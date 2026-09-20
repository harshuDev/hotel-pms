import { isValid, parseISO } from "date-fns";
import Link from "next/link";
import { PageHeader, cn } from "@/components/ui";
import { InventoryAll } from "@/components/inventory/inventory-all";
import {
  INVENTORY_NIGHTS,
  getBusinessDate,
  getInventoryGrid,
  getRatePlans,
} from "@/lib/queries";

export const metadata = { title: "Inventory" };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every field at once — the "why will this date not sell" screen.
 *
 * It reads the same `inventory_grid()` the nine editing screens read, because
 * that RPC already returns every column; there was nothing to add in Postgres,
 * only a way to look at it.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string; from?: string }>;
}) {
  const sp = await searchParams;
  const [businessDate, plans] = await Promise.all([
    getBusinessDate(),
    getRatePlans(),
  ]);

  const from =
    sp.from && ISO_DATE.test(sp.from) && isValid(parseISO(sp.from))
      ? sp.from
      : businessDate;

  const planId =
    (sp.plan && plans.some((p) => p.id === sp.plan) ? sp.plan : null) ??
    plans.find((p) => p.isDefault)?.id ??
    plans[0]?.id ??
    null;

  const cells = await getInventoryGrid(planId, from, INVENTORY_NIGHTS);

  function href(plan: string) {
    return `/inventory/all?plan=${plan}&from=${from}`;
  }

  return (
    <div>
      <PageHeader
        title="Inventory"
      />

      {plans.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xxs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Rate plan
          </span>
          {plans.map((p) => (
            <Link
              key={p.id}
              href={href(p.id)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-[13px]",
                p.id === planId
                  ? "border-chrome-800 bg-chrome-800 text-white"
                  : "border-line text-ink-muted hover:bg-shell hover:text-ink",
              )}
            >
              {p.name}
            </Link>
          ))}
        </div>
      )}

      <InventoryAll cells={cells} />
    </div>
  );
}
