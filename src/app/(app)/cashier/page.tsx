import { CashierClient } from "@/components/cashier-client";
import {
  getBusinessDate,
  getOpenShift,
  getPayableBookings,
  getPaymentMethods,
  getSuggestedOpeningFloat,
} from "@/lib/queries";

export default async function CashierPage() {
  const [shift, methods, payable, businessDate, suggestedFloat] =
    await Promise.all([
      getOpenShift(),
      getPaymentMethods(),
      getPayableBookings(),
      getBusinessDate(),
      getSuggestedOpeningFloat(),
    ]);

  return (
    <CashierClient
      shift={shift}
      methods={methods}
      payableBookings={payable}
      businessDate={businessDate}
      suggestedFloatCents={suggestedFloat}
    />
  );
}
