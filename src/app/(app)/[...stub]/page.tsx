import type { Metadata } from "next";
import { ComingSoon } from "@/components/ui";

const PHASES: Record<string, string> = {
  bookings: "Phase 2",
};

function titleFor(segments: string[]) {
  const last = segments[segments.length - 1] ?? "";
  return last
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ stub: string[] }>;
}): Promise<Metadata> {
  const { stub } = await params;
  return { title: titleFor(stub) || "Coming soon" };
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
