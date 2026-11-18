"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const DESTINATIONS = [
  ["/journal", "Journal"],
  ["/discover", "Discover"],
  ["/search", "Search"],
] as const;

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav className="site-nav" aria-label="Main">
      {DESTINATIONS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
