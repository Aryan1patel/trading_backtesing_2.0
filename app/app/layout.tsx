import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ChartLens — TradingView-style Charting",
  description:
    "A fast, focused charting tool for stocks with candlestick charts, technical indicators, replay mode, and paper trading. Supports Indian NSE symbols.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
