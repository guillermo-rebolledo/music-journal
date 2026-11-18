"use client";

import { LogInIcon, LogOutIcon, PaletteIcon, UserIcon } from "lucide-react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { authClient } from "@/lib/auth-client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Listener = { name: string; email: string; image?: string | null };

const trigger =
  "inline-flex size-11 items-center justify-center rounded-md outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 data-popup-open:bg-muted";

function ThemeMenu() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <PaletteIcon aria-hidden />
        Theme
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">System</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

async function signOut() {
  const result = await authClient.signOut().catch(() => null);
  if (result && !result.error) window.location.replace("/sign-in");
  else window.alert("Could not sign out. Try again.");
}

/** Avatar-triggered account menu; guests get the Theme menu and Sign in. Content mounts on open, so the client-only theme never hydrates. */
export function AccountMenu({ listener }: { listener: Listener | null }) {
  if (!listener)
    return (
      <DropdownMenu>
        <DropdownMenuTrigger aria-label="Menu" className={trigger}>
          <UserIcon aria-hidden className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <ThemeMenu />
          <DropdownMenuItem render={<Link href="/sign-in" />}>
            <LogInIcon aria-hidden />
            Sign in
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Account menu, ${listener.name}`} className={trigger}>
        <Avatar className="size-7">
          <AvatarImage src={listener.image ?? undefined} alt="" referrerPolicy="no-referrer" />
          <AvatarFallback>{listener.name.charAt(0).toUpperCase()}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="[overflow-wrap:anywhere]">
            Signed in as {listener.name}
            <span className="block text-muted-foreground">{listener.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuItem render={<Link href="/journal" />}>
          <UserIcon aria-hidden />
          My Journal
        </DropdownMenuItem>
        <ThemeMenu />
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut}>
          <LogOutIcon aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
