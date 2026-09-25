import { staffHtmlLang, staffT, type StaffLocale } from "@/lib/i18n/staff";

export function TopBar({
  propertyName,
  businessDate,
  lang,
}: {
  propertyName: string;
  businessDate: string;
  lang: StaffLocale;
}) {
  return (
    <div className="sticky top-14 z-30 flex h-9 items-center justify-between border-b border-line bg-white px-4 lg:px-5">
      <p className="font-display text-[13.5px] font-medium tracking-tightest text-ink">
        {propertyName}
      </p>
      <p className="text-[12.5px] text-ink-muted">
        <span lang={staffHtmlLang(lang)}>{staffT(lang, "businessDate")}</span>{" "}
        <span className="font-medium tabular-nums text-ink">
          {businessDate}
        </span>
      </p>
    </div>
  );
}
