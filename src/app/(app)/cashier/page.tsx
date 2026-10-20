import { CashierClient } from "@/components/cashier-client";
import { ShiftHistory } from "@/components/cashier/shift-history";
import {
  getBusinessDate,
  getCanSeeDrawerTotal,
  getOpenShift,
  getPayableBookings,
  getPaymentMethods,
  getProperty,
  getPropertyCurrency,
  getShiftHistory,
  getShiftLines,
  getSuggestedOpeningFloat,
  SHIFT_HISTORY_PER_PAGE,
} from "@/lib/queries";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Cashier"));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CashierPage({
  searchParams,
}: {
  searchParams: Promise<{ history_page?: string; shift?: string }>;
}) {
  const sp = await searchParams;
  const [shift, methods, payable, businessDate, suggestedFloat, canSeeExpected] =
    await Promise.all([
      getOpenShift(),
      getPaymentMethods(),
      getPayableBookings(),
      getBusinessDate(),
      getSuggestedOpeningFloat(),
      getCanSeeDrawerTotal(),
    ]);

  // Shift history (0141): managers and administrators, who already see the
  // expected drawer figure. Nobody else is shown other shifts' counts.
  let history = null;
  if (canSeeExpected) {
    const page =
      sp.history_page && /^\d+$/.test(sp.history_page) ? Math.max(Number(sp.history_page), 1) : 1;
    const [{ rows, total }, property, currency] = await Promise.all([
      getShiftHistory(page),
      getProperty(),
      getPropertyCurrency(),
    ]);
    // Only a shift listed on this page opens, so a URL cannot reach a shift
    // the history would not show.
    const openShiftId = sp.shift && UUID.test(sp.shift) && rows.some((r) => r.id === sp.shift) ? sp.shift : null;
    const detail = openShiftId ? await getShiftLines(openShiftId) : null;
    history = (
      <ShiftHistory
        rows={rows}
        total={total}
        page={page}
        perPage={SHIFT_HISTORY_PER_PAGE}
        openShiftId={openShiftId}
        detail={detail}
        currency={currency}
        timezone={property.timezone}
      />
    );
  }

  return (
    <div className="space-y-6">
      <CashierClient
        shift={shift}
        methods={methods}
        payableBookings={payable}
        businessDate={businessDate}
        suggestedFloatCents={suggestedFloat}
        canSeeExpected={canSeeExpected}
      />
      {history}
    </div>
  );
}
