import { CashierClient } from "@/components/cashier-client";
import {
  getBusinessDate,
  getCanSeeDrawerTotal,
  getOpenShift,
  getPayableBookings,
  getPaymentMethods,
  getSuggestedOpeningFloat,
} from "@/lib/queries";

export const metadata = { title: "Cashier" };

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
