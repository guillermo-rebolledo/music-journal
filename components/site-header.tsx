import Link from "next/link";
import { getListener } from "@/lib/auth";
import { AccountMenu } from "./account-menu";
import { MainNav } from "./main-nav";

/** Wordmark top left; collection navigation and the account menu top right. */
export async function SiteHeader() {
  const listener = await getListener();
  return (
    <header className="site-header">
      <Link href={listener ? "/journal" : "/sign-in"} className="wordmark">
        {/* ponytail: placeholder logo mark, swap for the real logo asset */}
        <span className="logo-mark" aria-hidden="true" />
        Music Journal
      </Link>
      <div className="site-header-actions">
        {listener && <MainNav />}
        <AccountMenu listener={listener ? { name: listener.name, email: listener.email, image: listener.image } : null} />
      </div>
    </header>
  );
}
