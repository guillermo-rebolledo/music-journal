import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { albumRedirect, artistRedirect, catalogState } from "./catalog-schema";
import { db } from "./db";

type CatalogKind = "album" | "artist";
export type CatalogGeneration = number | null;
export type CatalogTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type CatalogConnection = typeof db | CatalogTransaction;

export type CatalogAliasGroup = {
  id: string;
  ids: string[];
};

const redirects = { album: albumRedirect, artist: artistRedirect };

export const usesLocalCatalog = () => process.env.CATALOG_SOURCE === "local";

export async function pinCatalogGeneration(connection: CatalogConnection = db): Promise<CatalogGeneration> {
  if (!usesLocalCatalog()) return null;
  const [state] = await connection.select({ generation: catalogState.activeGeneration })
    .from(catalogState).where(eq(catalogState.singleton, true));
  return state?.generation ?? null;
}

/** Only the supplied IDs with a redirect are returned. Other IDs keep their own identity. */
export async function catalogCanonicalIds(
  kind: CatalogKind, generation: CatalogGeneration, ids: readonly string[], connection: CatalogConnection = db,
): Promise<Map<string, string>> {
  if (generation === null || !ids.length) return new Map();
  const redirect = redirects[kind];
  const rows = await connection.select({ oldId: redirect.oldMbid, id: redirect.mbid }).from(redirect)
    .where(and(eq(redirect.generation, generation), sql`${redirect.oldMbid} = ANY(${sql.param([...new Set(ids)])}::uuid[])`));
  return new Map(rows.map(({ oldId, id }) => [oldId, id]));
}

/** Keyed by canonical ID, including every old ID in the pinned generation. */
export async function catalogAliasGroups(
  kind: CatalogKind, generation: CatalogGeneration, ids: readonly string[], connection: CatalogConnection = db,
): Promise<Map<string, CatalogAliasGroup>> {
  const canonicalIds = await catalogCanonicalIds(kind, generation, ids, connection);
  const canonical = [...new Set(ids.map((id) => canonicalIds.get(id) ?? id))];
  const groups = new Map(canonical.map((id) => [id, { id, ids: [id] }]));
  if (generation !== null && canonical.length) {
    const redirect = redirects[kind];
    const rows = await connection.select({ oldId: redirect.oldMbid, id: redirect.mbid }).from(redirect)
      .where(and(eq(redirect.generation, generation), sql`${redirect.mbid} = ANY(${sql.param(canonical)}::uuid[])`))
      .orderBy(redirect.oldMbid);
    for (const { id, oldId } of rows) groups.get(id)?.ids.push(oldId);
  }
  return groups;
}

export async function catalogAliasGroup(
  kind: CatalogKind, generation: CatalogGeneration, id: string, connection: CatalogConnection = db,
): Promise<CatalogAliasGroup> {
  const groups = await catalogAliasGroups(kind, generation, [id], connection);
  const [group] = groups.values();
  return group;
}

export function withCatalogMembershipWrite<T>(
  listenerId: string, write: (tx: CatalogTransaction, generation: CatalogGeneration) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    // Serialize one listener's changes even when a submitted ID will be redirected.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${listenerId}, 21421))`);
    if (usesLocalCatalog()) await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(21421, 1)`);
    return write(tx, await pinCatalogGeneration(tx));
  }, { isolationLevel: "read committed" });
}
