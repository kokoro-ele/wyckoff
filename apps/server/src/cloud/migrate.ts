import { migrateCredits } from '../credits/migrate.js';
import { migrateBilling } from "../billing/migrate.js";
import { getMigrations } from "better-auth/db/migration";
import { getAuth } from "./auth.js";
import { getPool } from "./postgres.js";
const auth = getAuth();
const { runMigrations } = await getMigrations(auth.options);
await runMigrations();
await getPool().query(`CREATE TABLE IF NOT EXISTS workspaces (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  payload BYTEA,
  version INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`);
await migrateBilling(getPool());
await migrateCredits(getPool());
await getPool().end();
console.log("Authentication and workspace schema ready");
