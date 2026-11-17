import Link from "next/link";
import { SignOut } from "./journal/sign-out";

export function JournalHeader({ current }: { current: "journal" | "discover" }) {
  return (
    <header className="site-header">
      <span className="wordmark">Music Journal</span>
      <nav className="site-nav" aria-label="Main">
        <Link href="/journal" aria-current={current === "journal" ? "page" : undefined}>Journal</Link>
        <Link href="/discover" aria-current={current === "discover" ? "page" : undefined}>Discover</Link>
      </nav>
      <SignOut />
    </header>
  );
}
