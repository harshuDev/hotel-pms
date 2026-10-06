import { getT } from "@/lib/i18n/server";
import { PropertySwitcher } from "@/components/property-switcher";

export async function TopBar({
  propertyId,
  propertyName,
  businessDate,
  platformProperties,
}: {
  propertyId: string;
  propertyName: string;
  businessDate: string;
  /** Every hotel, for the platform team only (0135); empty for hotel staff. */
  platformProperties: { id: string; name: string }[];
}) {
  const tr = await getT();
  return (
    <div className="sticky top-14 z-30 flex h-9 items-center justify-between border-b border-line bg-white px-4 lg:px-5 print:hidden">
      {platformProperties.length > 0 ? (
        <PropertySwitcher properties={platformProperties} currentId={propertyId} />
      ) : (
        <p className="font-display text-[13.5px] font-medium tracking-tightest text-ink">
          {propertyName}
        </p>
      )}
      <p className="text-[12.5px] text-ink-muted">
        {tr("Business date")}{" "}
        <span className="font-medium tabular-nums text-ink">
          {businessDate}
        </span>
      </p>
    </div>
  );
}
