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

export type StaffRole =
  | "admin"
  | "manager"
  | "front_desk"
  | "cashier"
  | "housekeeping";

/** The signed-in member of staff. `staff_users`, never "profile". */
export interface StaffUser {
  id: string;
  fullName: string;
  role: StaffRole;
}

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
  /** Mirrors the cashier_shift_status enum. */
  status: "open" | "closing" | "closed";
  payments: ShiftPayment[];
  paidOuts: PaidOut[];
}

/** Read model returned by the Phase 4 cashier summary view/RPC. */
export interface CashierShiftSummary {
  shiftId: string;
  propertyId: string;
  cashierId: string;
  businessDate: string;
  status: "open" | "closing" | "closed";
  openedAt: string;
  closedAt: string | null;
  openingBalanceCents: bigint;
  cashPaymentsCents: bigint;
  cashAddedCents: bigint;
  paidOutsCents: bigint;
  cashDropsCents: bigint;
  adjustmentsCents: bigint;
  expectedCashCents: bigint;
  countedCashCents: bigint | null;
  varianceCents: bigint | null;
}

/** The stored housekeeping status. RoomState derives due_out and arriving on top. */
export type RoomStatus = "vacant_clean" | "vacant_dirty" | "occupied" | "ooo";

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
  /** `rooms.floor` is nullable; not every property numbers by floor. */
  floor: number | null;
  typeName: string;
  state: RoomState;
  guestName: string | null;
  nightsLeft: number | null;
}

/** One count per house-board segment. The six always sum to `totalRooms`. */
export type HouseStateCounts = Record<RoomState, number>;

export interface RoomFilters {
  q?: string;
  state?: RoomState | null;
  page?: number;
  perPage?: number;
}

/** Rooms are paged in Postgres — a property may have ~1,800 of them. */
export interface RoomsPage {
  rows: Room[];
  total: number;
  page: number;
  perPage: number;
}

export interface HouseSummary {
  sellable: number;
  /** Physically occupied: includes rooms due out today. */
  occupied: number;
  /**
   * Reservation movements for the business date, not room states. Most
   * arrivals have no room assigned yet, so these count booking rooms and are
   * deliberately larger than `states.arriving` / `states.due_out`.
   */
  arrivals: number;
  departures: number;
  vacantDirty: number;
  ooo: number;
  occupancyPct: number;
  /** Null when the viewer may not see a drawer total before it is counted. */
  drawerCents: number | null;
  outstandingCents: number;
  adrCents: number;
  totalRooms: number;
  /** Lets the collapsed house board render without loading any room rows. */
  states: HouseStateCounts;
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

export interface OccupancyRow {
  date: string;
  roomsSold: number;
  sellableRooms: number;
  occupancyPct: number;
  roomRevenueCents: number;
  adrCents: number;
  revparCents: number;
}

export interface OccupancySummary {
  nights: number;
  roomsSold: number;
  roomNightsAvailable: number;
  occupancyPct: number;
  roomRevenueCents: number;
  adrCents: number;
  revparCents: number;
}

export interface AvailabilityCell {
  date: string;
  roomTypeId: string;
  roomTypeCode: string;
  roomTypeName: string;
  totalRooms: number;
  outOfOrder: number;
  sellable: number;
  sold: number;
  /** Negative means the night is overbooked. */
  available: number;
}

export interface DebtorRow {
  bookingId: string;
  reference: string;
  customerName: string;
  status: BookingStatus;
  checkIn: string;
  checkOut: string;
  chargesCents: number;
  paymentsCents: number;
  outstandingCents: number;
  daysOverdue: number;
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
  // The property is UK-based and never offers UPI, but payment_method_kind
  // still carries the value, so the type has to admit it or a stray row
  // arrives mistyped.
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

/* -------------------------------------------------------------------------- */
/* Reports                                                                    */
/* -------------------------------------------------------------------------- */

export interface PaymentRow {
  paymentId: string;
  businessDate: string;
  paidAt: string;
  methodName: string;
  methodKind: FinancialPaymentMethod;
  affectsDrawer: boolean;
  bookingId: string;
  reference: string;
  guestName: string;
  receivedBy: string | null;
  externalReference: string | null;
  isReversal: boolean;
  /** Already signed: a reversal is negative. */
  amountCents: number;
}

export interface PaymentMethodTotal {
  methodName: string;
  methodKind: FinancialPaymentMethod;
  affectsDrawer: boolean;
  paymentCount: number;
  reversalCount: number;
  netCents: number;
}

export interface ExtrasRow {
  itemType: FolioItemType;
  itemCount: number;
  reversalCount: number;
  netCents: number;
  taxCents: number;
  grossCents: number;
}

export interface CheckoutRow {
  bookingId: string;
  reference: string;
  guestName: string;
  roomNumbers: string | null;
  channelName: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  chargesCents: number;
  paymentsCents: number;
  outstandingCents: number;
}

export interface FinancialRow {
  businessDate: string;
  roomRevenueCents: number;
  extrasRevenueCents: number;
  /** Negative: a discount reduces what is charged. */
  discountsCents: number;
  taxCents: number;
  chargesCents: number;
  paymentsCents: number;
  drawerPaymentsCents: number;
}

export interface BookingProductionRow {
  bookingId: string;
  reference: string;
  guestName: string;
  channelName: string | null;
  channelKind: ChannelKind | null;
  status: BookingStatus;
  settlement: Settlement;
  bookedOn: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomCount: number;
  roomNights: number;
  valueCents: number;
}

export interface ChannelProductionRow {
  channelName: string;
  channelKind: ChannelKind | null;
  commissionBps: number;
  bookingCount: number;
  canceledCount: number;
  roomNights: number;
  valueCents: number;
}

export interface ReservationsRow {
  arrivalDate: string;
  bookingCount: number;
  pendingCount: number;
  roomCount: number;
  adults: number;
  children: number;
  roomNights: number;
  valueCents: number;
}

export interface CancellationRow {
  bookingId: string;
  reference: string;
  guestName: string;
  channelName: string | null;
  status: BookingStatus;
  bookedOn: string;
  /** Null when the status change left no activity row to date it by. */
  cancelledOn: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  roomCount: number;
  roomNights: number;
  lostValueCents: number;
}

export interface ChannelRevenueRow {
  channelName: string;
  channelKind: ChannelKind | null;
  commissionBps: number;
  bookingCount: number;
  roomNights: number;
  roomRevenueCents: number;
  commissionCents: number;
  netRevenueCents: number;
}

export interface HousekeepingFloor {
  floor: number | null;
  roomCount: number;
  vacantClean: number;
  vacantDirty: number;
  occupied: number;
  dueOut: number;
  arriving: number;
  ooo: number;
}

export interface HousekeepingRoom {
  roomId: string;
  number: string;
  floor: number | null;
  roomTypeName: string;
  housekeepingStatus: RoomStatus;
  state: RoomState;
  guestName: string | null;
  nightsLeft: number | null;
}

export interface HousekeepingRoomsPage {
  rooms: HousekeepingRoom[];
  totalCount: number;
}

export interface InHouseRow {
  bookingId: string;
  reference: string;
  guestName: string;
  roomNumber: string | null;
  roomTypeName: string;
  channelName: string | null;
  checkIn: string;
  checkOut: string;
  nights: number;
  nightsStayed: number;
  nightsLeft: number;
  adults: number;
  children: number;
  balanceCents: number;
}

/* -------------------------------------------------------------------------- */
/* Taking a booking                                                           */
/* -------------------------------------------------------------------------- */

export interface BookableRoomType {
  roomTypeId: string;
  code: string;
  name: string;
  baseOccupancy: number;
  maxOccupancy: number;
  totalRooms: number;
  /** Free for the whole stay — the tightest night in it, not the average. */
  available: number;
}

export interface TaxRate {
  id: string;
  name: string;
  rateBps: number;
  inclusion: "inclusive" | "exclusive";
}
