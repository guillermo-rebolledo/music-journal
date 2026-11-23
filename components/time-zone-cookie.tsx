"use client";

import { useEffect } from "react";
import { timeZoneCookie } from "@/lib/display-date";

/** Reports the browser's time zone to the server; until it does, dates render in UTC (ADR 0001). */
export function TimeZoneCookie() {
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!zone) return;
    const value = encodeURIComponent(zone);
    if (!document.cookie.split("; ").includes(`${timeZoneCookie}=${value}`)) {
      document.cookie = `${timeZoneCookie}=${value}; path=/; max-age=31536000; samesite=lax`;
    }
  }, []);
  return null;
}
