import type { Metadata } from "next";
import { QuickApp } from "@/components/QuickApp";

export const metadata: Metadata = { title: "Quick bar — Dao TFT" };

export default function Quick() {
  return <QuickApp />;
}
