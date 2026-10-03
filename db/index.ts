import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getDb(database: D1Database | undefined) {
  if (!database) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Apply the local migrations and provide the DB binding before using persistent storage.",
    );
  }

  return drizzle(database, { schema });
}
