import { enqueueSubscriptionJob, type PgBossJobClient } from "./scheduler.js";

/** PRD §9.1: one durable scheduler tick per hour, not a process-local timer. */
export const HOURLY_SUBSCRIPTION_QUEUE = "subscription.hourly";
export const HOURLY_SUBSCRIPTION_CRON = "0 * * * *";

export interface ActiveSubscriptionSource {
  listActiveFollowingIds(): Promise<readonly string[]>;
}

export interface HourlySubscriptionRun {
  queued: number;
  alreadyQueued: number;
}

/**
 * Fan-out occurs through the existing subscription-scoped singleton keys, so
 * a scheduler restart or a second instance cannot check the same Season in
 * parallel. This function only enqueues work; it does not contact 115.
 */
export class HourlySubscriptionScheduler {
  constructor(private readonly subscriptions: ActiveSubscriptionSource, private readonly jobs: PgBossJobClient) {}

  async enqueueActiveSubscriptions(): Promise<HourlySubscriptionRun> {
    const ids = await this.subscriptions.listActiveFollowingIds();
    let queued = 0;
    let alreadyQueued = 0;
    for (const subscriptionId of ids) {
      const result = await enqueueSubscriptionJob(this.jobs, { subscriptionId, jobKind: "subscription.check" });
      if (result.jobId === null) alreadyQueued += 1;
      else queued += 1;
    }
    return { queued, alreadyQueued };
  }
}
