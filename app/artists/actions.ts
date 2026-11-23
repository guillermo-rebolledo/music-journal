"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getListener } from "../../lib/auth";
import { CatalogError, catalogMessages, findArtist, isAlbumId } from "../../lib/catalog";
import { catalogAliasGroup, usesLocalCatalog, withCatalogMembershipWrite } from "../../lib/catalog-identity";
import { artistMembership, findPinnedArtist } from "../../lib/journal";
import { artist, savedArtist } from "../../lib/schema";

export async function setSavedArtist(_previous: string | null, form: FormData): Promise<string | null> {
  const listener = await getListener();
  if (!listener) redirect("/sign-in");
  const id = form.get("artistId");
  const intent = form.get("intent");
  if (typeof id !== "string" || !isAlbumId(id) || !["save", "remove"].includes(String(intent))) return "Choose a valid artist and action.";
  const artistId = id.toLowerCase();
  try {
    const remoteDetails = !usesLocalCatalog() && intent === "save" ? await findArtist(artistId) : undefined;
    await withCatalogMembershipWrite(listener.id, async (tx, generation) => {
      const group = await catalogAliasGroup("artist", generation, artistId, tx);
      const membership = artistMembership(listener.id, group);
      if (intent === "save") {
        const [saved] = await tx.select({ id: savedArtist.artistId }).from(savedArtist).where(membership).limit(1);
        if (saved) return;
        const details = remoteDetails ?? await findPinnedArtist(generation, group, tx);
        await tx.insert(artist).values(details).onConflictDoNothing();
        await tx.insert(savedArtist).values({ listenerId: listener.id, artistId: group.id }).onConflictDoNothing();
      } else {
        await tx.delete(savedArtist).where(membership);
      }
    });
  } catch (error) {
    return error instanceof CatalogError ? error.kind === "missing" ? "This artist could not be found in the catalog." : catalogMessages[error.kind] : "Your list could not be updated. Please try again.";
  }
  revalidatePath("/journal");
  revalidatePath("/discover");
  revalidatePath("/search/artists");
  return null;
}
