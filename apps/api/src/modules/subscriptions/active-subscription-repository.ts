import type { QueryResultRow } from "pg";
import type { ActiveSubscriptionSource } from "./hourly-scheduler.js";

export interface ActiveSubscriptionQueryPool {
  query<Row extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<{ rows: Row[] }>;
}

/** SQL source for the scheduler; released, paused, stopped, and completed Seasons are excluded. */
export class PostgresActiveSubscriptionRepository implements ActiveSubscriptionSource {
  constructor(private readonly pool: ActiveSubscriptionQueryPool) {}

  async listActiveFollowingIds(): Promise<readonly string[]> {
    const result = await this.pool.query<{ id: string }>(`
      SELECT id::text AS id FROM subscriptions
      WHERE subscription_status = 'following'::subscription_status
        AND lifecycle_status = 'active'::lifecycle_status
      ORDER BY id ASC`);
    return result.rows.map((row) => row.id);
  }
}
