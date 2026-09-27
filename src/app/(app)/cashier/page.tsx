import { CashierClient } from "@/components/cashier-client";
import {
  getBusinessDate,
  getCanSeeDrawerTotal,
  getOpenShift,
  getPayableBookings,
  getPaymentMethods,
  getSuggestedOpeningFloat,
} from "@/lib/queries";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Cashier"));

export default async function CashierPage() {
  const [shift, methods, payable, businessDate, suggestedFloat, canSeeExpected] =
    await Promise.all([
      getOpenShift(),
      getPaymentMethods(),
      getPayableBookings(),
      getBusinessDate(),
      getSuggestedOpeningFloat(),
      getCanSeeDrawerTotal(),
    ]);

  return (
    <CashierClient
      shift={shift}
      methods={methods}
      payableBookings={payable}
      businessDate={businessDate}
      suggestedFloatCents={suggestedFloat}
      canSeeExpected={canSeeExpected}
    />
  );
}
