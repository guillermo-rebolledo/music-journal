"use server";

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getListener } from "../../../lib/auth";
import { CatalogError, catalogMessages, findAlbum, isAlbumId } from "../../../lib/catalog";
import { db } from "../../../lib/db";
import { album, listen, wantToListen } from "../../../lib/schema";
import { isListenDate } from "../../../lib/listen-date";

type ListenState = { error: string | null; submissionKey: string; success: boolean };

export async function logListen(previous: ListenState, form: FormData): Promise<ListenState> {
  const listener = await getListener();
  if (!listener) redirect("/sign-in");
  const id = form.get("albumId");
  const submissionKey = form.get("submissionKey");
  const listenDate = form.get("listenDate");
  const fail = (error: string) => ({ ...previous, error, success: false });
  if (typeof id !== "string" || !isAlbumId(id) || typeof submissionKey !== "string" || !isAlbumId(submissionKey)) return fail("Choose a valid album and submission.");
  const albumId = id.toLowerCase();
  try {
    const [existing] = await db.select().from(listen).where(and(eq(listen.listenerId, listener.id), eq(listen.submissionKey, submissionKey)));
    if (!existing) {
      if (typeof listenDate !== "string" || !isListenDate(listenDate)) return fail("Choose a valid listen date on or before today (UTC).");
      const details = await findAlbum(albumId);
      await db.transaction(async (tx) => {
        await tx.insert(album).values(details).onConflictDoNothing();
        const inserted = await tx.insert(listen).values({ listenerId: listener.id, albumId, submissionKey, listenDate }).onConflictDoNothing().returning();
        // Only the original submission removes membership; replays preserve later re-saves.
        if (inserted.length) await tx.delete(wantToListen).where(and(eq(wantToListen.listenerId, listener.id), eq(wantToListen.albumId, albumId)));
      });
    }
  } catch (error) {
    return fail(error instanceof CatalogError ? catalogMessages[error.kind] : "Your listen could not be logged. Please try again.");
  }
  revalidatePath("/journal");
  revalidatePath(`/albums/${albumId}`);
  return { error: null, submissionKey: randomUUID(), success: true };
}

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
