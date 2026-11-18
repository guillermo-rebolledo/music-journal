import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import { headers } from "next/headers";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;
const secret = process.env.BETTER_AUTH_SECRET;
const previewHosts = process.env.VERCEL_ENV === "preview"
  ? [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL].filter((host): host is string => Boolean(host))
  : [];
const baseURL = previewHosts.length
  ? { allowedHosts: previewHosts, protocol: "https" as const }
  : process.env.BETTER_AUTH_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL must point to the Music Journal database.");
}

if (!baseURL) {
  throw new Error("Set BETTER_AUTH_URL or enable Vercel system environment variables for Preview.");
}

if (!secret || secret.length < 32) {
  throw new Error("Set a generated BETTER_AUTH_SECRET of at least 32 characters.");
}

export const auth = betterAuth({
  baseURL,
  secret,
  database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
  emailAndPassword: { enabled: true },
  advanced: { cookiePrefix: "music-journal" },
});

export async function getListener() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user;
}
