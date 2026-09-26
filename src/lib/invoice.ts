import type { InvoiceLine } from "@/lib/queries";

/** One printed line of an invoice. */
export interface InvoiceRow {
  key: string;
  date: string;
  description: string;
  room: string | null;
  netCents: number;
  taxCents: number;
  grossCents: number;
}

/**
 * The invoice's lines, from the folio's charges and two Invoice Settings
 * switches (0080). Pure, so the rules are one place and testable:
 *
 *   - showNightsBreakdown: every room night charged is its own line; off,
 *     one line per room -- the nights charged less any reversed -- dated by
 *     the first night.
 *   - showRoomNumberForExtras: an extra carries `soleRoom`, the booking's one
 *     room when it has exactly one. An extra is posted to the booking, not a
 *     room, so on a group there is no room to name and none is guessed.
 *
 * A room charge always carries its room: that one is recorded on the night.
 */
export function invoiceRows(
  lines: InvoiceLine[],
  opts: { showNightsBreakdown: boolean; showRoomNumberForExtras: boolean; soleRoom: string | null },
): InvoiceRow[] {
  const isRoomCharge = (l: InvoiceLine) => l.itemType === "room_charge" && l.bookingRoomId !== null;
  const described = (l: InvoiceLine) => (l.isReversal ? `${l.description} (reversed)` : l.description);
  const rows: InvoiceRow[] = [];

  if (opts.showNightsBreakdown) {
    for (const l of lines.filter(isRoomCharge)) {
      rows.push({
        key: l.lineId,
        date: l.stayDate ?? l.businessDate,
        description: described(l),
        room: l.roomNumber,
        netCents: l.netCents,
        taxCents: l.taxCents,
        grossCents: l.grossCents,
      });
    }
  } else {
    const byRoom = new Map<string, InvoiceLine[]>();
    for (const l of lines.filter(isRoomCharge)) {
      const k = l.bookingRoomId as string;
      byRoom.set(k, [...(byRoom.get(k) ?? []), l]);
    }
    for (const [k, ls] of byRoom) {
      const nights = ls.filter((l) => !l.isReversal).length - ls.filter((l) => l.isReversal).length;
      const dates = ls.map((l) => l.stayDate ?? l.businessDate).sort();
      rows.push({
        key: k,
        date: dates[0],
        description: `Accommodation, ${nights} night${nights === 1 ? "" : "s"}`,
        room: ls.find((l) => l.roomNumber)?.roomNumber ?? null,
        // Column sums of posted integer cents, as the reports' totals are.
        netCents: ls.reduce((s, l) => s + l.netCents, 0),
        taxCents: ls.reduce((s, l) => s + l.taxCents, 0),
        grossCents: ls.reduce((s, l) => s + l.grossCents, 0),
      });
    }
  }

  for (const l of lines.filter((x) => !isRoomCharge(x))) {
    rows.push({
      key: l.lineId,
      date: l.businessDate,
      description: described(l),
      room: opts.showRoomNumberForExtras ? opts.soleRoom : null,
      netCents: l.netCents,
      taxCents: l.taxCents,
      grossCents: l.grossCents,
    });
  }

  return rows.sort((a, b) => a.date.localeCompare(b.date));
}
