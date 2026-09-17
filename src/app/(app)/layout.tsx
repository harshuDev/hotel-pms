import { format, parseISO } from "date-fns";
import { TopNav } from "@/components/top-nav";
import { TopBar } from "@/components/top-bar";
import { signOut } from "@/lib/actions/auth";
import {
  getBusinessDate,
  getCurrentStaffUser,
  getProperty,
} from "@/lib/queries";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
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
            No staff account
          </h1>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-muted">
            Your sign-in worked, but it is not linked to a staff account at any
            property, so there is nothing to show. An administrator needs to add
            you before you can use the system.
          </p>
          <form action={signOut}>
            <button
              type="submit"
              className="mt-6 rounded-md bg-chrome-800 px-5 py-2 text-sm font-medium text-white hover:bg-chrome-900"
            >
              Log out
            </button>
          </form>
        </div>
      </main>
    );
  }

  const [property, today] = await Promise.all([
    getProperty(),
    getBusinessDate(),
  ]);

  const businessDate = format(parseISO(today), "EEE d MMM yyyy");

  return (
    <div className="min-h-screen">
      <TopNav
        propertyName={property.name}
        staffName={staff.fullName}
        staffRole={staff.role}
      />

      <TopBar
        propertyName={property.name}
        businessDate={businessDate}
      />

      <main className="p-3 sm:p-5">
        {children}
      </main>
    </div>
  );
}