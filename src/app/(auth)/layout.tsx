import { StaffI18n } from "@/components/staff-i18n";

/*
 * /login, /forgot-password and /reset-password, in the staff language (0106).
 * A route group, so the URLs are unchanged. Before sign-in there is no
 * staff_users row, so the language is the one this browser last chose.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <StaffI18n>{children}</StaffI18n>;
}
