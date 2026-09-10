import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { MapsProvider } from "@/components/maps/map-provider";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { ReminderToast } from "@/components/pwa/reminder-toast";
import { PwaUtilityBar } from "@/components/pwa/pwa-utility-bar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://piki-dada.vercel.app"),
  title: "Piki Dada",
  description: "Your trusted partner for safe, reliable boda rides and fast deliveries across the city and beyond.",
  manifest: "/manifest.json",
  openGraph: {
    title: "Piki Dada",
    description: "Your trusted partner for safe, reliable boda rides and fast deliveries across the city and beyond.",
    images: ["/brand/og-image.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Piki Dada",
    description: "Your trusted partner for safe, reliable boda rides and fast deliveries across the city and beyond.",
    images: ["/brand/og-image.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#060707",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-50">
        <Script src="/pwa-bootstrap.js" strategy="beforeInteractive" />
        <ServiceWorkerRegister />
        <MapsProvider>{children}</MapsProvider>
        <PwaUtilityBar />
        <ReminderToast />
      </body>
    </html>
  );
}
