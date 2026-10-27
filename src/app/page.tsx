import type { Metadata } from "next";
import { RouterApp } from "@/components/RouterApp";

export const metadata: Metadata = { title: "Dao TFT - Guided" };

export default function Home() {
  return <RouterApp />;
}
