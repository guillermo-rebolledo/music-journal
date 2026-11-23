import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { albumRedirect, artistRedirect, catalogState } from "./catalog-schema";
import { db } from "./db";
import { CatalogError } from "./provider";

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

export function catalogSqlError(operation: string, error: unknown) {
  const failure = error as { code?: string; cause?: { code?: string } } | undefined;
  const timeout = (failure?.cause?.code ?? failure?.code) === "57014";
  console.info("Catalog read", { operation, outcome: timeout ? "db-timeout" : "db-error" });
  return new CatalogError(timeout ? "timeout" : "upstream");
}

async function readGeneration(connection: CatalogConnection): Promise<CatalogGeneration> {
  const [state] = await connection.select({ generation: catalogState.activeGeneration })
    .from(catalogState).where(eq(catalogState.singleton, true));
  return state?.generation ?? null;
}

export async function pinCatalogGeneration(): Promise<CatalogGeneration> {
  try {
    return await readGeneration(db);
  } catch (error) {
    catalogSqlError("pin-generation", error);
    return null;
  }
}

/** Only the supplied IDs with a redirect are returned. Other IDs keep their own identity. */
async function readCanonicalIds(
  kind: CatalogKind, generation: CatalogGeneration, ids: readonly string[], connection: CatalogConnection,
): Promise<Map<string, string>> {
  if (generation === null || !ids.length) return new Map();
  const redirect = redirects[kind];
  const rows = await connection.select({ oldId: redirect.oldMbid, id: redirect.mbid }).from(redirect)
    .where(and(eq(redirect.generation, generation), sql`${redirect.oldMbid} = ANY(${sql.param([...new Set(ids)])}::uuid[])`));
  return new Map(rows.map(({ oldId, id }) => [oldId, id]));
}

export async function catalogCanonicalIds(kind: CatalogKind, generation: CatalogGeneration, ids: readonly string[]) {
  try {
    return await readCanonicalIds(kind, generation, ids, db);
  } catch (error) {
    catalogSqlError(`canonical-${kind}`, error);
    return new Map<string, string>();
  }
}

function exactGroups(ids: readonly string[]) {
  return new Map(ids.map((id) => [id, { id, ids: [id] }]));
}

async function readAliasGroups(
  kind: CatalogKind, generation: CatalogGeneration, ids: readonly string[], connection: CatalogConnection,
): Promise<Map<string, CatalogAliasGroup>> {
  const canonicalIds = await readCanonicalIds(kind, generation, ids, connection);
  const groups = exactGroups(ids.map((id) => canonicalIds.get(id) ?? id));
  if (generation !== null && groups.size) {
    const redirect = redirects[kind];
    const rows = await connection.select({ oldId: redirect.oldMbid, id: redirect.mbid }).from(redirect)
      .where(and(eq(redirect.generation, generation), sql`${redirect.mbid} = ANY(${sql.param([...groups.keys()])}::uuid[])`))
      .orderBy(redirect.oldMbid);
    for (const { id, oldId } of rows) groups.get(id)?.ids.push(oldId);
  }
  return groups;
}

/** Keyed by canonical ID, including every old ID in the pinned generation. */
export async function catalogAliasGroups(kind: CatalogKind, generation: CatalogGeneration, ids: readonly string[]) {
  try {
    return await readAliasGroups(kind, generation, ids, db);
  } catch (error) {
    catalogSqlError(`aliases-${kind}`, error);
    return exactGroups(ids);
  }
}

export async function resolveCatalogIdentity(kind: CatalogKind, id: string, tx?: CatalogTransaction) {
  const read = async (connection: CatalogConnection) => {
    const generation = await readGeneration(connection);
    const groups = await readAliasGroups(kind, generation, [id], connection);
    const [group] = groups.values();
    return { generation, group };
  };

  try {
    // A failed Catalog statement must roll back to a savepoint before writing to the Journal.
    return await (tx ? tx.transaction(read) : read(db));
  } catch (error) {
    catalogSqlError(`identity-${kind}`, error);
    return { generation: null, group: { id, ids: [id] } };
  }
}

class RemoteDetailsNeeded {
  constructor(readonly id: string) {}
}

export async function withCatalogMembershipWrite<T, Details extends { id: string }>(
  listenerId: string,
  kind: CatalogKind,
  id: string,
  fetchRemote: (id: string) => Promise<Details>,
  write: (
    tx: CatalogTransaction, group: CatalogAliasGroup, generation: CatalogGeneration, remote: (id: string) => Details,
  ) => Promise<T>,
): Promise<T> {
  const fetched = new Map<string, Details>();
  // Fetch outside the transaction so upstream requests cannot hold Journal locks or exhaust the pool.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(21421, 1)`);
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${listenerId}, 21421))`);
        const { generation, group } = await resolveCatalogIdentity(kind, id, tx);
        return write(tx, group, generation, (id) => {
          const details = fetched.get(id);
          if (!details) throw new RemoteDetailsNeeded(id);
          return details;
        });
      });
    } catch (error) {
      if (!(error instanceof RemoteDetailsNeeded)) throw error;
      if (attempt === 2) break;
      fetched.set(error.id, await fetchRemote(error.id));
    }
  }
  throw new CatalogError("upstream");
}
