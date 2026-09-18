import { PageHeader } from "@/components/ui";
import {
  SettingsScreen,
  type SettingsTab,
} from "@/components/settings/settings-screen";
import {
  getChannelSettings,
  getCurrentStaffUser,
  getPaymentMethodSettings,
  getPropertySettings,
  getRoomsForSettings,
  getRoomTypeSettings,
  getSeasonSettings,
  getStaffSettings,
  getTaxRateSettings,
} from "@/lib/queries";

export const metadata = { title: "Settings" };

const TABS: SettingsTab[] = [
  "property",
  "room-types",
  "rooms",
  "channels",
  "tax",
  "seasons",
  "payment-methods",
  "staff",
];

function isTab(value: string | undefined): value is SettingsTab {
  return TABS.includes(value as SettingsTab);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; page?: string; edit?: string }>;
}) {
  const sp = await searchParams;
  const tab = isTab(sp.tab) ? sp.tab : "property";
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
    paymentMethods,
    staff,
    me,
  ] = await Promise.all([
    getPropertySettings(),
    getRoomTypeSettings(),
    getRoomsForSettings({ q: roomQuery, page: roomPage }),
    getChannelSettings(),
    getTaxRateSettings(),
    getSeasonSettings(),
    getPaymentMethodSettings(),
    getStaffSettings(),
    getCurrentStaffUser(),
  ]);

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="The rooms, sources and rates this property sells against"
      />
      <SettingsScreen
        tab={tab}
        property={property}
        roomTypes={roomTypes}
        rooms={rooms}
        roomQuery={roomQuery}
        channels={channels}
        taxRates={taxRates}
        seasons={seasons}
        editRoomTypeId={editRoomTypeId}
        paymentMethods={paymentMethods}
        staff={staff}
        meId={me?.id ?? null}
        canEdit={me !== null && ["admin", "manager"].includes(me.role)}
        isAdmin={me?.role === "admin"}
      />
    </div>
  );
}
