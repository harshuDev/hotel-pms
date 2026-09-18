import { PageHeader } from "@/components/ui";
import { ProfileScreen } from "@/components/profile/profile-screen";
import { getCurrentStaffUser } from "@/lib/queries";

export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const me = await getCurrentStaffUser();

  // The layout above already refuses to render without a staff row, so this is
  // unreachable in practice — but the type says it can be null and guessing is
  // not a thing to do with an identity.
  if (!me) return null;

  return (
    <div>
      <PageHeader
        title="Profile"
        subtitle="Your name, as it appears on everything you do here"
      />
      <ProfileScreen fullName={me.fullName} role={me.role} />
    </div>
  );
}
