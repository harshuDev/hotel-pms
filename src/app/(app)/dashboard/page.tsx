import { getT } from "@/lib/i18n/server";
import { addDays, format, parseISO, subDays } from "date-fns";
import { HouseBoard } from "@/components/dashboard/house-board";
import { HouseStrip } from "@/components/dashboard/house-strip";
import { LiveFeed } from "@/components/dashboard/live-feed";
import { Movements } from "@/components/dashboard/movements";
import { Pace } from "@/components/dashboard/pace";
import { CloseDay } from "@/components/dashboard/close-day";
import { ChannelMix } from "@/components/dashboard/channel-mix";
import {
  getActivity,
  getArrivals,
  getBusinessDate,
  getChannelReport,
  getCurrentStaffUser,
  getDepartures,
  getHouseSummary,
  getOccupancyForecast,
  getRevenueSeries,
  PACE_DAYS,
} from "@/lib/queries";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Dashboard"));

export default async function DashboardPage() {
  const tr = await getT();
  const today = await getBusinessDate();

  // The pace chart reads backwards and forwards from the business date:
  // revenue for the 28 nights up to and including it, occupancy for the 28
  // starting on it.
  const revenueFrom = format(
    subDays(parseISO(today), PACE_DAYS - 1),
    "yyyy-MM-dd",
  );

  // The channel mix covers the same 28 nights the pace chart forecasts.
  const channelTo = format(addDays(parseISO(today), PACE_DAYS - 1), "yyyy-MM-dd");

  // No room list here: the house board renders from counts and loads rooms
  // only when it is expanded.
  const [activity, arrivals, departures, occupancy, revenue, house, channels] =
    await Promise.all([
      getActivity(),
      getArrivals(today),
      getDepartures(today),
      getOccupancyForecast(today),
      getRevenueSeries(revenueFrom),
      getHouseSummary(),
      getChannelReport(today, channelTo),
    ]);

  const staff = await getCurrentStaffUser();
  const canCloseDay = staff?.role === "admin" || staff?.role === "manager";
  const canMoveGuests = canCloseDay || staff?.role === "front_desk";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-[26px] font-semibold leading-none tracking-tightest text-ink">
            {tr("Dashboard")}
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {tr("business day open")}
          </p>
        </div>
        {canCloseDay && (
          <CloseDay
            businessDate={today}
            // Departures on the business date include overdue guests (0111);
            // those still in are the ones closing the day leaves unbilled.
            stillIn={departures
              .filter((b) => b.status === "checked_in" && b.departureDate <= today)
              .map((b) => ({
                bookingId: b.id,
                reference: b.reference,
                guestName: b.customerName,
                roomNumber: b.roomNumber,
                departureDate: b.departureDate,
              }))}
          />
        )}
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
          <ChannelMix rows={channels} from={today} to={channelTo} />
          <LiveFeed items={activity} />
        </div>
      </div>
    </div>
  );
}
