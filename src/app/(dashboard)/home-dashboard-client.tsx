"use client";

import dynamic from "next/dynamic";

const HomeDashboard = dynamic(
  () => import("@/features/home/components/home-dashboard").then((mod) => mod.HomeDashboard),
  { ssr: false },
);

export function HomeDashboardClient() {
  return <HomeDashboard />;
}
