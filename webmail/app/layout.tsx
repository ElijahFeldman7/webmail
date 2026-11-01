import type { Metadata, Viewport } from "next";
import { Google_Sans, Roboto } from "next/font/google";
import "./globals.css";

const gsans = Google_Sans({ variable: "--font-gsans", subsets: ["latin"], weight: ["400", "500", "700"], display: "swap" });
const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin"], weight: ["400", "500", "700"], display: "swap" });

export const metadata: Metadata = {
  title: "TJ Mail",
  description: "TJHSST webmail",
  icons: { icon: "/tjlogo.png" },
  referrer: "same-origin",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f8fafd" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${gsans.variable} ${roboto.variable}`}>
      <body>{children}</body>
    </html>
  );
}
