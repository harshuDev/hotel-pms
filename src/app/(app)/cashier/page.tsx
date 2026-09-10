import { CashierClient } from "@/components/cashier-client";
import { PAYMENT_METHODS, BOOKINGS } from "@/lib/mock/data";
import { getCurrentCashierShift } from "@/lib/mock/queries";

export default async function CashierPage() {
  const shift = await getCurrentCashierShift();
  const payable = BOOKINGS.filter((b) => b.balanceCents > 0).slice(0, 20);

  return (
    <CashierClient
      initialShift={shift}
      methods={PAYMENT_METHODS}
      payableBookings={payable}
    />
  );
}
