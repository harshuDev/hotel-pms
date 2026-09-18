import { CustomersScreen } from "@/components/customers/customers-screen";
import { getCurrentStaffUser, getCustomers } from "@/lib/queries";

export const metadata = { title: "Customers" };

/** Who Postgres will let create or correct a customer. `save_customer()` checks too. */
const CAN_EDIT = ["admin", "manager", "front_desk"];
/** Merging rewrites who a booking belonged to. `merge_customers()` checks too. */
const CAN_MERGE = ["admin", "manager"];

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const kind = sp.kind ?? "all";
  const q = sp.q ?? "";

  const [{ rows, total, page, perPage }, staff] = await Promise.all([
    getCustomers({ q, kind, page: Number(sp.page ?? 1) }),
    getCurrentStaffUser(),
  ]);

  /*
   * The read stays here, in a Server Component, and the rows go to the client
   * component as a prop. Only the table's own state — which rows are ticked,
   * which dialog is open — needs the browser.
   *
   * The role is passed so the buttons can say why they are unavailable rather
   * than failing on click. Postgres checks it again in every RPC; this is
   * courtesy, not the gate.
   */
  return (
    <CustomersScreen
      rows={rows}
      total={total}
      page={page}
      perPage={perPage}
      q={q}
      kind={kind}
      canEdit={staff !== null && CAN_EDIT.includes(staff.role)}
      canMerge={staff !== null && CAN_MERGE.includes(staff.role)}
    />
  );
}
