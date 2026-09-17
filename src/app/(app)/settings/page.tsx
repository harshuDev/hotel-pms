import { PageHeader } from "@/components/ui";
import {
  SettingsScreen,
  type SettingsTab,
} from "@/components/settings/settings-screen";
import {
  getChannelSettings,
  getCurrentStaffUser,
  getPropertySettings,
  getRoomTypeSettings,
  getStaffSettings,
  getTaxRateSettings,
} from "@/lib/queries";

export const metadata = { title: "The Grand Hotel — Settings" };

const TABS: SettingsTab[] = [
  "property",
  "room-types",
  "rooms",
  "channels",
  "tax",
  "staff",
];

function isTab(value: string | undefined): value is SettingsTab {
  return TABS.includes(value as SettingsTab);
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = isTab(sp.tab) ? sp.tab : "property";

  const [property, roomTypes, channels, taxRates, staff, me] = await Promise.all([
    getPropertySettings(),
    getRoomTypeSettings(),
    getChannelSettings(),
    getTaxRateSettings(),
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
        channels={channels}
        taxRates={taxRates}
        staff={staff}
        meId={me?.id ?? null}
        canEdit={me !== null && ["admin", "manager"].includes(me.role)}
        isAdmin={me?.role === "admin"}
      />
    </div>
  );
}
