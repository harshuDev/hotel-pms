import { HouseBoard } from "@/components/dashboard/house-board";
import { HouseStrip } from "@/components/dashboard/house-strip";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { Movements } from "@/components/dashboard/movements";
import { Pace } from "@/components/dashboard/pace";
import {
  getActivity,
  getArrivals,
  getBusinessDate,
  getDepartures,
  getHouseSummary,
  getOccupancyForecast,
  getRevenueSeries,
  getRooms,
} from "@/lib/mock/queries";

export const metadata = { title: "Grand Ferndale — Dashboard" };

export default async function DashboardPage() {
  const today = await getBusinessDate();
  const [activity, arrivals, departures, occupancy, revenue, rooms, house] =
    await Promise.all([
      getActivity(),
      getArrivals(today),
      getDepartures(today),
      getOccupancyForecast(),
      getRevenueSeries(),
      getRooms(),
      getHouseSummary(),
    ]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-none tracking-tightest text-ink">
            Dashboard
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">business day open</p>
        </div>
      </div>
      <HouseStrip s={house} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <div className="space-y-3">
          <HouseBoard rooms={rooms} />
          <Pace occupancy={occupancy} revenue={revenue} today={today} />
        </div>
        <div className="space-y-3">
          <Movements arrivals={arrivals} departures={departures} />
          <LiveFeed items={activity} />
        </div>
      </div>
    </div>
  );
}
