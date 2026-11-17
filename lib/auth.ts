import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { headers } from "next/headers";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
const baseURL = process.env.BETTER_AUTH_URL;
const secret = process.env.BETTER_AUTH_SECRET;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must point to the Music Journal database.");
}

if (!baseURL || !secret || secret.length < 32) {
  throw new Error("Set BETTER_AUTH_URL and a generated BETTER_AUTH_SECRET of at least 32 characters.");
}

export const auth = betterAuth({
  baseURL,
  secret,
  database: drizzleAdapter(drizzle(databaseUrl), { provider: "pg", schema, transaction: true }),
  emailAndPassword: { enabled: true },
  advanced: { cookiePrefix: "music-journal" },
});

export async function getListener() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user;
}
