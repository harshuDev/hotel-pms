import { getT } from "@/lib/i18n/server";
import { PageHeader } from "@/components/ui";
import { ProfileScreen } from "@/components/profile/profile-screen";
import { getCurrentStaffUser } from "@/lib/queries";
import { pageTitle } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/translate";

export const generateMetadata = pageTitle(msg("Profile"));

export default async function ProfilePage() {
  const tr = await getT();
  const me = await getCurrentStaffUser();

  // The layout above already refuses to render without a staff row, so this is
  // unreachable in practice — but the type says it can be null and guessing is
  // not a thing to do with an identity.
  if (!me) return null;

  return (
    <div>
      <PageHeader
        title={tr("Profile")}
      />
      <ProfileScreen fullName={me.fullName} role={me.role} />
    </div>
  );
}
