"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { CatalogError, catalogMessages, findArtist, isAlbumId } from "../../lib/catalog";
import { db } from "../../lib/db";
import { artist, savedArtist } from "../../lib/schema";

export async function setSavedArtist(_previous: string | null, form: FormData): Promise<string | null> {
  const listener = await getListener();
  if (!listener) redirect("/sign-in");
  const id = form.get("artistId");
  const intent = form.get("intent");
  if (typeof id !== "string" || !isAlbumId(id) || !["save", "remove"].includes(String(intent))) return "Choose a valid artist and action.";
  const artistId = id.toLowerCase();
  try {
    if (intent === "save") {
      const details = await findArtist(artistId);
      await db.transaction(async (tx) => {
        await tx.insert(artist).values(details).onConflictDoNothing();
        await tx.insert(savedArtist).values({ listenerId: listener.id, artistId }).onConflictDoNothing();
      });
    } else {
      await db.delete(savedArtist).where(and(eq(savedArtist.listenerId, listener.id), eq(savedArtist.artistId, artistId)));
    }
  } catch (error) {
    return error instanceof CatalogError ? error.kind === "missing" ? "This artist could not be found in the catalog." : catalogMessages[error.kind] : "Your list could not be updated. Please try again.";
  }
  revalidatePath("/journal");
  revalidatePath("/search/artists");
  return null;
}
