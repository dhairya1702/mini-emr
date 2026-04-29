"use client";

import dynamic from "next/dynamic";

export const LazySettingsDrawer = dynamic(
  () => import("@/components/settings-drawer").then((module) => module.SettingsDrawer),
  {
    ssr: false,
  },
);
