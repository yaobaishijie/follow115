import { AppError, type SubscriptionAction } from "@follow115/contracts";
import type { FastifyInstance } from "fastify";
import { enqueueSubscriptionJob, type PgBossJobClient } from "./scheduler.js";
import type { CreateSubscriptionInput, SubscriptionRepository } from "./repository.js";

type CreateBody = { mediaMetadataId?: unknown; seasonNumber?: unknown; targetQuality?: unknown };
type UpdateBody = { action?: unknown };

function createInput(body: CreateBody | undefined): CreateSubscriptionInput {
  if (typeof body?.mediaMetadataId !== "string" || !body.mediaMetadataId.trim()) throw new AppError("VALIDATION_ERROR", "mediaMetadataId must not be empty.");
  if (!Number.isInteger(body.seasonNumber) || (body.seasonNumber as number) < 0) throw new AppError("VALIDATION_ERROR", "seasonNumber must be a non-negative integer.");
  if (body.targetQuality !== "1080p" && body.targetQuality !== "2160p") throw new AppError("VALIDATION_ERROR", "targetQuality must be 1080p or 2160p.");
  return { mediaMetadataId: body.mediaMetadataId, seasonNumber: body.seasonNumber as number, targetQuality: body.targetQuality };
}

export function registerSubscriptionRoutes(app: FastifyInstance, repository: SubscriptionRepository, jobs: PgBossJobClient): void {
  app.post<{ Body: CreateBody }>("/api/v1/subscriptions", async (request) => {
    const subscription = await repository.create(createInput(request.body));
    await enqueueSubscriptionJob(jobs, { subscriptionId: subscription.id, jobKind: "subscription.check" });
    return subscription;
  });
  app.patch<{ Params: { id: string }; Body: UpdateBody }>("/api/v1/subscriptions/:id", async (request) => {
    const action = request.body?.action;
    if (action === "upgradeQuality") {
      const subscription = await repository.queueQualityUpgrade(request.params.id);
      await enqueueSubscriptionJob(jobs, { subscriptionId: subscription.id, jobKind: "quality.upgrade" });
      return subscription;
    }
    if (action === "release") {
      const requested = await repository.requestRelease(request.params.id);
      await jobs.send("cleanup", {
        subscriptionId: requested.subscription.id,
        requestId: requested.requestId,
        generation: requested.generation
      }, { singletonKey: `subscription:${requested.subscription.id}:cleanup:${requested.generation}`, retryLimit: 5, retryDelay: 15 });
      return requested.subscription;
    }
    const transitions: Record<string, SubscriptionAction> = { pause: "pause", resume: "resume", stop: "stop", refollow: "refollow", check: "beginCheck" };
    if (typeof action !== "string" || transitions[action] === undefined) throw new AppError("VALIDATION_ERROR", "action is invalid.");
    const subscription = await repository.transition(request.params.id, transitions[action]!);
    if (action === "check" || action === "refollow") await enqueueSubscriptionJob(jobs, { subscriptionId: subscription.id, jobKind: "subscription.check" });
    return subscription;
  });
}
