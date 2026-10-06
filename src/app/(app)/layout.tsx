import { getT } from "@/lib/i18n/server";
import type { Metadata } from "next";
import { TopNav } from "@/components/top-nav";
import { StaffI18n } from "@/components/staff-i18n";
import { TopBar } from "@/components/top-bar";
import { CurrencyProvider } from "@/components/currency";
import { signOut } from "@/lib/actions/auth";
import {
  getBusinessDate,
  getCurrentStaffUser,
  getHotelFeatures,
  getInventorySettings,
  getPlatformProperties,
  getProperty,
} from "@/lib/queries";
import { hiddenNavHrefs } from "@/lib/hotel-features";
import { hiddenInventoryHrefs } from "@/lib/inventory-settings";

/**
 * The browser tab carries the property's real name, not a hard-coded one.
 *
 * Every page under this layout exports a bare title — "Dashboard", "Settings"
 * — and the template here supplies the hotel. That is what makes renaming the
 * property in Settings reach the tab as well as the bar, and it is the only
 * honest option in a system where property_id is on every tenant table: a
 * name compiled into thirty-odd files can only ever describe one hotel.
 *
 * getProperty() throws when the signed-in user has no staff_users row, which
 * is a real state — the layout below renders a panel for it. Metadata must not
 * be what turns that into an error page, so it falls back to the generic title
 * and lets the layout do the explaining.
 */
export async function generateMetadata(): Promise<Metadata> {
  const staff = await getCurrentStaffUser();
  if (!staff) return {};

  const property = await getProperty();
  return {
    title: { default: property.name, template: `%s \u2014 ${property.name}` },
  };
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tr = await getT();
  // Read first and alone. Without a staff_users row, current_property_id() is
  // null, so getProperty() and getBusinessDate() find no rows and throw — the
  // panel below would never render if they ran alongside this.
  const staff = await getCurrentStaffUser();

  // Authenticated, but with no staff_users row there is no property to scope
  // anything to. Redirecting to /login would loop forever, because middleware
  // sends a signed-in user straight back here, so say what is wrong and offer
  // the one action that helps.
  if (!staff) {
    return (
      <main className="grid min-h-screen place-items-center bg-shell px-5">
        <div className="w-full max-w-md rounded-lg border border-line bg-white p-8 text-center shadow-card">
          <h1 className="font-display text-[22px] font-semibold tracking-tightest text-ink">
            {tr("No staff account")}
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            {tr("Your sign-in worked, but it is not linked to an active staff account, so there is nothing to show. Either the account was never set up or it has been deactivated. An administrator can sort it out.")}
          </p>
          <form action={signOut}>
            <button
              type="submit"
              className="mt-6 rounded-md bg-chrome-800 px-5 py-2 text-sm font-medium text-white hover:bg-chrome-900"
            >
              {tr("Log out")}
            </button>
          </form>
        </div>
      </main>
    );
  }

  const [property, today, features, inventorySettings, platformProperties] = await Promise.all([
    getProperty(),
    getBusinessDate(),
    getHotelFeatures(),
    getInventorySettings(),
    getPlatformProperties(),
  ]);

  const businessDate = tr.date(today, "EEE d MMM yyyy");

  return (
    // Every client component below reads the staff language from here (0106).
    <StaffI18n>
      <div className="min-h-screen">
        <TopNav
          propertyId={property.id}
          propertyName={property.name}
          staffName={staff.fullName}
          staffRole={staff.role}
          // Hotel Features (0076) and Inventory -> Settings visibility (0088).
          hiddenHrefs={[...hiddenNavHrefs(features), ...hiddenInventoryHrefs(inventorySettings)]}
        />

        <TopBar
          propertyId={property.id}
          propertyName={property.name}
          platformProperties={platformProperties.map((p) => ({ id: p.id, name: p.name }))}
          businessDate={businessDate}
        />

        <main className="p-3 sm:p-5">
          {/* Every amount in the staff app is written in the property's own
              currency; client components read it from here. */}
          <CurrencyProvider currency={property.currency.trim()}>
            {children}
          </CurrencyProvider>
        </main>
      </div>
    </StaffI18n>
  );
}