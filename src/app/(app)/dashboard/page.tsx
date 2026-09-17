import { format, parseISO, subDays } from "date-fns";
import { HouseBoard } from "@/components/dashboard/house-board";
import { HouseStrip } from "@/components/dashboard/house-strip";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { Movements } from "@/components/dashboard/movements";
import { Pace } from "@/components/dashboard/pace";
import { CloseDay } from "@/components/dashboard/close-day";
import {
  getActivity,
  getArrivals,
  getBusinessDate,
  getCurrentStaffUser,
  getDepartures,
  getHouseSummary,
  getOccupancyForecast,
  getRevenueSeries,
  PACE_DAYS,
} from "@/lib/queries";

export const metadata = { title: "The Grand Hotel — Dashboard" };

export default async function DashboardPage() {
  const today = await getBusinessDate();

  // The pace chart reads backwards and forwards from the business date:
  // revenue for the 28 nights up to and including it, occupancy for the 28
  // starting on it.
  const revenueFrom = format(
    subDays(parseISO(today), PACE_DAYS - 1),
    "yyyy-MM-dd",
  );

  // No room list here: the house board renders from counts and loads rooms
  // only when it is expanded.
  const [activity, arrivals, departures, occupancy, revenue, house] =
    await Promise.all([
      getActivity(),
      getArrivals(today),
      getDepartures(today),
      getOccupancyForecast(today),
      getRevenueSeries(revenueFrom),
      getHouseSummary(),
    ]);

  const staff = await getCurrentStaffUser();
  const canCloseDay = staff?.role === "admin" || staff?.role === "manager";
  const canMoveGuests = canCloseDay || staff?.role === "front_desk";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-none tracking-tightest text-ink">
            Dashboard
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            business day open
          </p>
        </div>
        {canCloseDay && <CloseDay businessDate={today} />}
      </div>

      <HouseStrip s={house} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <HouseBoard counts={house.states} total={house.totalRooms} />
          <Pace
            occupancy={occupancy}
            revenue={revenue}
            today={today}
          />
        </div>

        <div className="space-y-3">
          <Movements
            arrivals={arrivals}
            departures={departures}
            canMoveGuests={canMoveGuests}
          />
          <LiveFeed items={activity} />
        </div>
      </div>
    </div>
  );
}
