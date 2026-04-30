/* eslint-disable no-console */
import { listBusinesses, updateBusiness, updateAssessment, getAssessment } from "../lib/db";
import { isExcludedName } from "../lib/scoring";

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("TURSO_DATABASE_URL is not set.");
    process.exit(1);
  }
  const dryRun = process.argv.includes("--dry-run");

  const businesses = await listBusinesses();
  const matches = businesses.filter((b) => isExcludedName(b.name));
  console.log(`Found ${matches.length} businesses matching exclusion patterns:\n`);

  for (const b of matches) {
    console.log(`  ${b.name} (current: status=${b.status}, fit=${b.fit_score})`);
    if (!dryRun) {
      await updateBusiness(b.id, {
        status: "dead",
        fit_score: 0,
        fit_reason: "excluded — not a real catering/web customer (court/govt/event/etc.)",
        notes: b.notes ? `${b.notes} [auto-excluded]` : "[auto-excluded]",
      });
      // Also wipe pitch priority on the web side
      const a = await getAssessment(b.id);
      if (a) {
        await updateAssessment(b.id, {
          pitch_priority: 0,
          jack_status: "dead",
        });
      }
    }
  }

  console.log(
    dryRun
      ? `\n[--dry-run] No changes made. Re-run without --dry-run to mark these as dead.`
      : `\n✓ Marked ${matches.length} businesses as dead.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
