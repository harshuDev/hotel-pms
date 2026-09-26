import Link from "next/link";
import { cn } from "@/components/ui";
import {
  ReportFigure,
  ReportFigures,
  ReportShell,
} from "@/components/reports/report-shell";
import { ReportFeatureOff, ReportTable } from "@/components/reports/report-table";
import { RoomStatusAction } from "@/components/settings/room-status-action";
import {
  HOUSEKEEPING_PAGE_SIZE,
  getBusinessDate,
  getHotelFeatures,
  getHousekeepingRooms,
  getHousekeepingSummary,
} from "@/lib/queries";
import type {
  HousekeepingFloor,
  HousekeepingRoom,
  RoomState,
} from "@/lib/types";

export const metadata = { title: "Housekeeping report" };

const STATES: { value: RoomState; label: string; dot: string }[] = [
  { value: "vacant_dirty", label: "To clean", dot: "bg-rose-500" },
  { value: "due_out", label: "Due out", dot: "bg-warn" },
  { value: "occupied", label: "Occupied", dot: "bg-chrome-700" },
  { value: "arriving", label: "Arriving", dot: "bg-brass" },
  { value: "vacant_clean", label: "Ready", dot: "bg-emerald-500" },
  { value: "ooo", label: "Out of order", dot: "bg-slate-400" },
];

function isRoomState(value: string | undefined): value is RoomState {
  return STATES.some((s) => s.value === value);
}

/** Preserves the other filters when one of them changes. */
function href(params: {
  floor?: number | null;
  state?: RoomState | null;
  page?: number;
}) {
  const q = new URLSearchParams();
  if (params.floor !== null && params.floor !== undefined)
    q.set("floor", String(params.floor));
  if (params.state) q.set("state", params.state);
  if (params.page && params.page > 1) q.set("page", String(params.page));
  const s = q.toString();
  return s ? `/reports/housekeeping?${s}` : "/reports/housekeeping";
}

export default async function HousekeepingReportPage({
  searchParams,
}: {
  searchParams: Promise<{ floor?: string; state?: string; page?: string }>;
}) {
  // Hotel Features (0076): "Enable Housekeeping Feature" is this report, and
  // "... Status Modification ..." is its Mark it column.
  const features = await getHotelFeatures();
  if (!features.housekeeping) {
    return (
      <ReportShell title="Housekeeping">
        <ReportFeatureOff feature="Enable Housekeeping Feature" />
      </ReportShell>
    );
  }
  const canMark = features.housekeeping_status_modification;

  const sp = await searchParams;
  const floor = sp.floor !== undefined && /^-?\d+$/.test(sp.floor)
    ? Number(sp.floor)
    : null;
  const state = isRoomState(sp.state) ? sp.state : null;
  const page = sp.page && /^\d+$/.test(sp.page) ? Math.max(Number(sp.page), 1) : 1;

  const [businessDate, floors, rooms] = await Promise.all([
    getBusinessDate(),
    getHousekeepingSummary(),
    getHousekeepingRooms({ floor, state, page }),
  ]);

  const total = (pick: (f: HousekeepingFloor) => number) =>
    floors.reduce((sum, f) => sum + pick(f), 0);

  const roomCount = total((f) => f.roomCount);
  const toClean = total((f) => f.vacantDirty);
  const dueOut = total((f) => f.dueOut);
  const ooo = total((f) => f.ooo);

  const lastPage = Math.max(
    Math.ceil(rooms.totalCount / HOUSEKEEPING_PAGE_SIZE),
    1,
  );

  return (
    <ReportShell
      title="Housekeeping"
      date={businessDate}
    >
      <ReportFigures>
        <ReportFigure
          label="To clean"
          value={String(toClean + dueOut)}
          detail={`${toClean} vacant dirty, ${dueOut} due out`}
          emphasis
        />
        <ReportFigure
          label="Rooms"
          value={String(roomCount)}
          detail={`Across ${floors.length} floor${floors.length === 1 ? "" : "s"}`}
        />
        <ReportFigure
          label="Ready to sell"
          value={String(total((f) => f.vacantClean))}
        />
        <ReportFigure
          label="Out of order"
          value={String(ooo)}
          detail={ooo === 0 ? "Every room sellable" : "Not sellable"}
        />
      </ReportFigures>

      <div className="mb-3">
        <ReportTable<HousekeepingFloor>
          rows={floors}
          rowKey={(f) => String(f.floor ?? "none")}
          minWidth="640px"
          emptyTitle="No rooms are set up"
          emptyHint="Add rooms before housekeeping has anything to work from."
          footLabel={`${floors.length} floor${floors.length === 1 ? "" : "s"}`}
          columns={[
            {
              header: "Floor",
              cell: (f) => (
                <Link
                  href={href({ floor: f.floor, state })}
                  className="font-medium text-ink underline-offset-2 hover:underline"
                >
                  {f.floor === null ? "Unnumbered" : `Floor ${f.floor}`}
                </Link>
              ),
            },
            {
              header: "Rooms",
              align: "right",
              cell: (f) => <span className="text-ink-muted">{f.roomCount}</span>,
              foot: String(roomCount),
            },
            {
              header: "To clean",
              align: "right",
              cell: (f) => (
                <span className={f.vacantDirty > 0 ? "font-medium text-rose-600" : "text-ink-faint"}>
                  {f.vacantDirty || "—"}
                </span>
              ),
              foot: String(toClean),
            },
            {
              header: "Due out",
              align: "right",
              cell: (f) => (
                <span className={f.dueOut > 0 ? "font-medium text-warn-deep" : "text-ink-faint"}>
                  {f.dueOut || "—"}
                </span>
              ),
              foot: String(dueOut),
            },
            {
              header: "Occupied",
              align: "right",
              cell: (f) => (
                <span className="text-ink-muted">{f.occupied || "—"}</span>
              ),
              foot: String(total((x) => x.occupied)),
            },
            {
              header: "Arriving",
              align: "right",
              cell: (f) => (
                <span className="text-ink-muted">{f.arriving || "—"}</span>
              ),
              foot: String(total((x) => x.arriving)),
            },
            {
              header: "Ready",
              align: "right",
              cell: (f) => (
                <span className="text-ink-muted">{f.vacantClean || "—"}</span>
              ),
              foot: String(total((x) => x.vacantClean)),
            },
            {
              header: "Out of order",
              align: "right",
              cell: (f) => (
                <span className={f.ooo > 0 ? "text-slate-500" : "text-ink-faint"}>
                  {f.ooo || "—"}
                </span>
              ),
              foot: String(ooo),
            },
          ]}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <Link
          href={href({ floor })}
          className={cn(
            "rounded-md border px-3 py-1.5 text-[13px]",
            state === null
              ? "border-chrome-800 bg-chrome-800 text-white"
              : "border-line text-ink-muted hover:bg-shell hover:text-ink",
          )}
        >
          All states
        </Link>
        {STATES.map((s) => (
          <Link
            key={s.value}
            href={href({ floor, state: s.value })}
            className={cn(
              "flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px]",
              state === s.value
                ? "border-chrome-800 bg-chrome-800 text-white"
                : "border-line text-ink-muted hover:bg-shell hover:text-ink",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
            {s.label}
          </Link>
        ))}
        {floor !== null && (
          <Link
            href={href({ state })}
            className="ml-1 rounded-md border border-line px-3 py-1.5 text-[13px] text-ink-muted hover:bg-shell hover:text-ink"
          >
            Floor {floor} ✕
          </Link>
        )}
      </div>

      <ReportTable<HousekeepingRoom>
        rows={rooms.rooms}
        rowKey={(r) => r.roomId}
        minWidth="720px"
        emptyTitle="No rooms match these filters"
        emptyHint="Clear the state or floor filter to see the whole house."
        footLabel={
          rooms.totalCount > HOUSEKEEPING_PAGE_SIZE
            ? `${rooms.rooms.length} of ${rooms.totalCount} rooms`
            : `${rooms.totalCount} room${rooms.totalCount === 1 ? "" : "s"}`
        }
        columns={[
          {
            header: "Room",
            cell: (r) => (
              <>
                <span className="tnum font-medium text-ink">{r.number}</span>
                <span className="block text-xxs text-ink-faint">{r.roomTypeName}</span>
              </>
            ),
          },
          {
            header: "Floor",
            cell: (r) => (
              <span className="text-ink-muted">
                {r.floor === null ? "—" : r.floor}
              </span>
            ),
          },
          {
            header: "State",
            cell: (r) => {
              const s = STATES.find((x) => x.value === r.state);
              return (
                <span className="flex items-center gap-1.5 text-ink-muted">
                  <span className={cn("h-1.5 w-1.5 rounded-full", s?.dot ?? "bg-line")} />
                  {s?.label ?? r.state}
                </span>
              );
            },
          },
          {
            header: "Housekeeping",
            cell: (r) => (
              <span className="text-ink-faint">
                {r.housekeepingStatus.replace("_", " ")}
              </span>
            ),
          },
          {
            header: "Guest",
            cell: (r) => (
              <span className="text-ink-muted">{r.guestName ?? "—"}</span>
            ),
          },
          {
            header: "Nights left",
            align: "right",
            cell: (r) => (
              <span className="text-ink-faint">
                {r.nightsLeft === null ? "—" : r.nightsLeft}
              </span>
            ),
          },
          ...(canMark
            ? [
                {
                  header: "Mark it",
                  cell: (r: HousekeepingRoom) => (
                    <RoomStatusAction roomId={r.roomId} status={r.housekeepingStatus} />
                  ),
                },
              ]
            : []),
        ]}
      />

      {lastPage > 1 && (
        <div className="mt-3 flex items-center justify-between text-[13px]">
          <p className="text-ink-faint">
            Page {page} of {lastPage}
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={href({ floor, state, page: page - 1 })}
                className="rounded-md border border-line px-3 py-1.5 text-ink-muted hover:bg-shell hover:text-ink"
              >
                Previous
              </Link>
            )}
            {page < lastPage && (
              <Link
                href={href({ floor, state, page: page + 1 })}
                className="rounded-md border border-line px-3 py-1.5 text-ink-muted hover:bg-shell hover:text-ink"
              >
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </ReportShell>
  );
}
