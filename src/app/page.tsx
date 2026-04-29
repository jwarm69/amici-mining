import { listBusinesses, stats } from "@/lib/db";
import { PipelineClient } from "./pipeline-client";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!process.env.TURSO_DATABASE_URL) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-8">
        <h1 className="text-xl font-semibold mb-2">Amici Mining</h1>
        <p className="text-sm text-[var(--color-muted)]">
          TURSO_DATABASE_URL is not set. Add it to your environment to view the pipeline.
        </p>
      </div>
    );
  }

  const [businesses, summary] = await Promise.all([listBusinesses(), stats()]);

  return <PipelineClient initialBusinesses={businesses} summary={summary} />;
}
