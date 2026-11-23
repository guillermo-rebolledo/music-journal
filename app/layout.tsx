import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { SiteHeader } from "@/components/site-header";
import { TimeZoneCookie } from "@/components/time-zone-cookie";
import "./globals.css";

export const metadata: Metadata = {
  title: "Music Journal",
  description: "A private journal for the music you listen to.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" enableSystem disableTransitionOnChange>
          <a className="skip-link" href="#main-content">Skip to content</a>
          <TimeZoneCookie />
          <SiteHeader />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
