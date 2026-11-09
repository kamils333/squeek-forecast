import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Squeek Forecast — predict the hamster's daily distance",
  icons: { icon: "/favicon.svg" },
  description:
    "Guess how far Squeektoshi runs on Squeekchain's real wheel each day and climb the leaderboard. Community project for the Squeekchain Genesis Buildooooor badge.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
