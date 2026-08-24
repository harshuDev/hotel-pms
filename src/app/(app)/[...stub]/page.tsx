import { ComingSoon } from "@/components/ui";

const PHASES: Record<string, string> = {
  calendar: "Phase 2",
  inventory: "Phase 2",
  offers: "Phase 2",
  reports: "Phase 3",
  bookings: "Phase 2",
};

function titleFor(segments: string[]) {
  const last = segments[segments.length - 1] ?? "";
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default async function StubPage({
  params,
}: {
  params: Promise<{ stub: string[] }>;
}) {
  const { stub } = await params;
  const phase = PHASES[stub[0]] ?? "Phase 2";
  return <ComingSoon label={titleFor(stub) || "Coming soon"} phase={phase} />;
}
