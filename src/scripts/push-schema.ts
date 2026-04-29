/* eslint-disable no-console */
import { ensureSchema } from "../lib/db";

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("TURSO_DATABASE_URL is not set. Add it to .env.local first.");
    process.exit(1);
  }
  console.log("Pushing schema to", process.env.TURSO_DATABASE_URL);
  await ensureSchema();
  console.log("✓ Schema applied.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
