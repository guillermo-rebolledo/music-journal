"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getListener } from "../../../lib/auth";
import { CatalogError, catalogMessages, findAlbum, isAlbumId } from "../../../lib/catalog";
import { db } from "../../../lib/db";
import { album, wantToListen } from "../../../lib/schema";

export async function setWantToListen(_previous: string | null, form: FormData): Promise<string | null> {
  const listener = await getListener();
  if (!listener) redirect("/sign-in");
  const id = form.get("albumId");
  const intent = form.get("intent");
  if (typeof id !== "string" || !isAlbumId(id) || !["save", "remove"].includes(String(intent))) return "Choose a valid album and action.";
  const albumId = id.toLowerCase();
  try {
    if (intent === "save") {
      const details = await findAlbum(albumId);
      await db.transaction(async (tx) => {
        await tx.insert(album).values(details).onConflictDoNothing();
        await tx.insert(wantToListen).values({ listenerId: listener.id, albumId }).onConflictDoNothing();
      });
    } else {
      await db.delete(wantToListen).where(and(eq(wantToListen.listenerId, listener.id), eq(wantToListen.albumId, albumId)));
    }
  } catch (error) {
    return error instanceof CatalogError ? catalogMessages[error.kind] : "Your list could not be updated. Please try again.";
  }
  revalidatePath("/journal");
  revalidatePath(`/albums/${albumId}`);
  return null;
}
