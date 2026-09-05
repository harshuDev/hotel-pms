export type BookingStatus =
  | "pending"
  | "confirmed"
  | "checked_in"
  | "checked_out"
  | "canceled"
  | "no_show";

export type ChannelKind = "direct" | "ota" | "wholesaler" | "gds" | "offline";
export type Settlement = "at_property" | "prepaid_to_channel" | "virtual_card";
export type CustomerKind = "personal" | "company";

export type ActivityKind =
  | "BOOKING"
  | "CANCELLATION"
  | "MODIFICATION"
  | "PAYMENT"
  | "CHECKIN"
  | "CHECKOUT";

export interface Channel {
  id: string;
  name: string;
  kind: ChannelKind;
  commissionBps: number;
}

export interface RoomType {
  id: string;
  code: string;
  name: string;
}

export interface Customer {
  id: string;
  ref: string;
  kind: CustomerKind;
  name: string;
  nationalIdNumber: string | null;
  email: string | null;
  phone: string | null;
  excludeFromEmail: boolean;
  bookingCount: number;
  totalRevenueCents: number;
  lastBookingDate: string | null;
  balanceCents: number;
}

export interface Booking {
  id: string;
  reference: string;
  customerId: string;
  customerName: string;
  channelName: string;
  settlement: Settlement;
  status: BookingStatus;
  arrivalDate: string;
  departureDate: string;
  bookedAt: string;
  nights: number;
  roomCount: number;
  roomTypeName: string;
  roomNumber: string | null;
  adults: number;
  children: number;
  totalCents: number;
  balanceCents: number;
  typeLine?: string;
}

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  summary: string;
  emphasis: string[];
  createdAt: string;
  unread: boolean;
}

export interface SeriesPoint {
  date: string;
  value: number;
}

export interface PaymentMethod {
  id: string;
  name: string;
  affectsDrawer: boolean;
}

export interface ShiftPayment {
  id: string;
  bookingRef: string;
  guestName: string;
  methodId: string;
  methodName: string;
  affectsDrawer: boolean;
  amountCents: number;
  createdAt: string;
}

export type PaidOutCategory =
  | "taxi"
  | "guest_purchase"
  | "medical"
  | "supplies"
  | "staff_advance"
  | "other";

export interface PaidOut {
  id: string;
  amountCents: number;
  category: PaidOutCategory;
  reason: string;
  payee: string;
  rechargeBookingRef: string | null;
  createdAt: string;
}

export interface Shift {
  id: string;
  userName: string;
  businessDate: string;
  openedAt: string;
  openingFloatCents: number;
  status: "open" | "closed" | "approved";
  payments: ShiftPayment[];
  paidOuts: PaidOut[];
}

export type RoomState =
  | "occupied"
  | "due_out"
  | "arriving"
  | "vacant_clean"
  | "vacant_dirty"
  | "ooo";

export interface Room {
  id: string;
  number: string;
  floor: number;
  typeName: string;
  state: RoomState;
  guestName: string | null;
  nightsLeft: number | null;
}

export interface HouseSummary {
  sellable: number;
  occupied: number;
  arrivals: number;
  departures: number;
  vacantDirty: number;
  ooo: number;
  occupancyPct: number;
  drawerCents: number;
  outstandingCents: number;
  adrCents: number;
}

/** Financial ledger shapes used by the eventual Supabase query layer. Amounts
 * are integer minor units; UI formatting remains centralized in money.ts. */
export type FolioStatus = "open" | "closed" | "cancelled";
export type FolioSettlementStatus =
  | "open"
  | "partially_paid"
  | "settled"
  | "credit_balance"
  | "closed"
  | "cancelled";
export type FolioItemType =
  | "room_charge"
  | "tax"
  | "food_beverage"
  | "laundry"
  | "minibar"
  | "transport"
  | "miscellaneous"
  | "discount"
  | "adjustment"
  | "reversal";
export type FinancialPaymentMethod =
  | "cash"
  | "card"
  | "bank_transfer"
  | "upi"
  | "ota_prepaid"
  | "virtual_card"
  | "complimentary"
  | "other";

export interface FolioBalance {
  folioId: string;
  bookingId: string;
  totalChargesCents: bigint;
  totalPaymentsCents: bigint;
  outstandingCents: bigint;
  settlementStatus: FolioSettlementStatus;
}

export interface FolioItem {
  id: string;
  folioId: string;
  bookingId: string;
  businessDate: string;
  itemType: FolioItemType;
  description: string;
  quantity: number;
  unitAmountCents: bigint;
  netAmountCents: bigint;
  taxAmountCents: bigint;
  amountCents: bigint;
  signedAmountCents: bigint;
  reversesId: string | null;
  postedAt: string;
}
