"use server";

import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getListener } from "../../../lib/auth";
import { CatalogError, catalogMessages, fetchRemoteAlbum, isAlbumId } from "../../../lib/catalog";
import { withCatalogMembershipWrite } from "../../../lib/catalog-identity";
import { db } from "../../../lib/db";
import { albumMembership, resolveAlbum } from "../../../lib/journal";
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
  const submission = and(eq(listen.listenerId, listener.id), eq(listen.submissionKey, submissionKey));
  try {
    const [existing] = await db.select({ submissionKey: listen.submissionKey }).from(listen).where(submission);
    if (!existing) {
      if (typeof listenDate !== "string" || !isListenDate(listenDate)) return fail("Choose a valid listen date on or before today (UTC).");
      await withCatalogMembershipWrite(listener.id, "album", albumId, fetchRemoteAlbum, async (tx, group, generation, remote) => {
        // Only the original submission removes membership; replays preserve later re-saves.
        const [existing] = await tx.select({ submissionKey: listen.submissionKey }).from(listen).where(submission);
        if (existing) return;
        const details = await resolveAlbum(generation, group, tx, remote);
        await tx.insert(album).values(details).onConflictDoNothing();
        const inserted = await tx.insert(listen).values({ listenerId: listener.id, albumId: group.id, submissionKey, listenDate }).onConflictDoNothing().returning();
        if (inserted.length) await tx.delete(wantToListen).where(albumMembership(listener.id, group));
      });
    }
  } catch (error) {
    return fail(error instanceof CatalogError ? catalogMessages[error.kind] : "Your listen could not be logged. Please try again.");
  }
  revalidatePath("/journal");
  revalidatePath("/discover");
  revalidatePath("/albums/[id]", "page");
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
    await withCatalogMembershipWrite(listener.id, "album", albumId, fetchRemoteAlbum, async (tx, group, generation, remote) => {
      const membership = albumMembership(listener.id, group);
      if (intent === "save") {
        const [saved] = await tx.select({ id: wantToListen.albumId }).from(wantToListen).where(membership).limit(1);
        if (saved) return;
        const details = await resolveAlbum(generation, group, tx, remote);
        await tx.insert(album).values(details).onConflictDoNothing();
        await tx.insert(wantToListen).values({ listenerId: listener.id, albumId: group.id }).onConflictDoNothing();
      } else {
        await tx.delete(wantToListen).where(membership);
      }
    });
  } catch (error) {
    return error instanceof CatalogError ? catalogMessages[error.kind] : "Your list could not be updated. Please try again.";
  }
  revalidatePath("/journal");
  revalidatePath("/discover");
  revalidatePath("/albums/[id]", "page");
  return null;
}
