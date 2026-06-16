import type { Metadata, Viewport } from "next";
import { Baloo_2, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { ParadiseBackdrop } from "@/components/paradise-backdrop";
import { Toaster } from "@/components/ui/sonner";

const display = Baloo_2({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const sans = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bali Stays · vote together 🌴",
  description: "Compare and vote on places to stay for our Bali trip.",
};

export const viewport: Viewport = {
  themeColor: "#16a7b8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} h-full antialiased`}
    >
      <body className="min-h-dvh">
        <ParadiseBackdrop />
        <div className="relative z-0 flex min-h-dvh flex-col">{children}</div>
        <Toaster position="top-center" richColors />
      </body>
    </html>
  );
}
