import { SettingsScreen } from "@/components/settings/settings-screen";
import {
  DEFAULT_SETTINGS_TAB,
  isSettingsTab,
} from "@/lib/settings-tabs";
import {
  getChannelSettings,
  getCurrentStaffUser,
  getHotelPolicies,
  getPaymentMethodSettings,
  getPropertySettings,
  getRoomsForSettings,
  getRoomTypeSettings,
  getRatePlans,
  getCancellationPolicies,
  getSeasonSettings,
  getStaffSettings,
  getTaxRateSettings,
} from "@/lib/queries";

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string; edit?: string }>;
}) {
  const sp = await searchParams;
  const tab = isSettingsTab(sp.tab) ? sp.tab : DEFAULT_SETTINGS_TAB;
  const roomQuery = sp.q?.trim() ?? "";
  const roomPage = Math.max(1, Number(sp.page) || 1);
  // The calendar rail links here with a room type to rename.
  const editRoomTypeId = sp.edit?.trim() || null;

  const [
    property,
    roomTypes,
    rooms,
    channels,
    taxRates,
    seasons,
    ratePlans,
    cancellationPolicies,
    paymentMethods,
    staff,
    me,
    hotelPolicies,
  ] = await Promise.all([
    getPropertySettings(),
    getRoomTypeSettings(),
    getRoomsForSettings({ q: roomQuery, page: roomPage }),
    getChannelSettings(),
    getTaxRateSettings(),
    getSeasonSettings(),
    getRatePlans(),
    getCancellationPolicies(),
    getPaymentMethodSettings(),
    getStaffSettings(),
    getCurrentStaffUser(),
    getHotelPolicies(),
  ]);

  /*
   * The timezone list is worked out here, on the server, and handed down: if
   * the browser built its own, Node's ICU and the browser's can list different
   * zones, and the select would render one way on the server and another in
   * the browser -- a hydration mismatch.
   */
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    // No page heading: the reference's Settings has none -- its sidebar says
    // where you are and each panel carries its own title.
    <div>
      <SettingsScreen
        tab={tab}
        property={property}
        roomTypes={roomTypes}
        rooms={rooms}
        roomQuery={roomQuery}
        channels={channels}
        taxRates={taxRates}
        seasons={seasons}
        ratePlans={ratePlans}
        cancellationPolicies={cancellationPolicies}
        editRoomTypeId={editRoomTypeId}
        paymentMethods={paymentMethods}
        staff={staff}
        meId={me?.id ?? null}
        canEdit={me !== null && ["admin", "manager"].includes(me.role)}
        isAdmin={me?.role === "admin"}
        timezones={timezones}
        hotelPolicies={hotelPolicies}
      />
    </div>
  );
}
