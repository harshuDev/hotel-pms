export function TopBar({
  propertyName,
  businessDate,
}: {
  propertyName: string;
  businessDate: string;
}) {
  return (
    <header className="sticky top-0 z-20 hidden h-14 items-center justify-between border-b border-line bg-white px-5 lg:flex">
      <p className="font-display text-[15px] font-semibold tracking-tightest text-ink">
        {propertyName}
      </p>
      <div className="flex items-center gap-5 text-[13px]">
        <span className="text-ink-muted">{businessDate}</span>
        <span className="h-4 w-px bg-line" />
        <span className="text-ink">Shekher</span>
      </div>
    </header>
  );
}
