import { I18nProvider } from "@/components/i18n";
import { getStaffDictionary, getStaffLocale } from "@/lib/i18n/server";

/** Puts this request's staff language round a tree, for its client components. */
export async function StaffI18n({ children }: { children: React.ReactNode }) {
  const locale = await getStaffLocale();
  const dictionary = await getStaffDictionary(locale);
  return (
    <I18nProvider locale={locale} dictionary={dictionary}>
      {children}
    </I18nProvider>
  );
}
