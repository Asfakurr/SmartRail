import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "SmartRail BD | Journey intelligence prototype",
  description:
    "Unofficial FYP prototype for simulated train tracking, arrival prediction and boarding-station delay notifications.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
