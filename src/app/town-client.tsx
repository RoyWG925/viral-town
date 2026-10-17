"use client";

import dynamic from "next/dynamic";

// The 3D scene touches window and WebGL, so it only renders in the browser.
const TownScene = dynamic(() => import("@/town/TownScene"), {
  ssr: false,
  loading: () => <div className="fixed inset-0 grid place-items-center bg-[#ffd6a6] text-lg font-semibold text-slate-700">Loading Mistport…</div>,
});

export default function TownClient() {
  return <TownScene />;
}
