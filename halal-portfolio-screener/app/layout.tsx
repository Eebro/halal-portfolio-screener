import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Halal Portfolio Screener",
  description:
    "Screen your brokerage holdings for Shariah compliance and calculate purification owed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
