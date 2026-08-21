import type { FastifyInstance } from "fastify";
import { AppError } from "@follow115/contracts";
import type { CleanupCandidateRepository } from "./repository.js";

export interface CleanupCandidateJobClient { send(name: string, data: unknown, options?: { singletonKey?: string; retryLimit?: number; retryDelay?: number }): Promise<unknown>; }

export function registerCleanupCandidateRoutes(app: FastifyInstance, repository: CleanupCandidateRepository, requireAuth: (headers: Record<string, string | string[] | undefined>) => Promise<unknown>, jobs?: CleanupCandidateJobClient): void {
  app.get("/api/v1/cleanup-candidates", async (request) => {
    await requireAuth(request.headers);
    return { items: await repository.listPending(), nextCursor: null };
  });
  if (!jobs) return;
  const enqueue = async (candidateIds: readonly string[]) => {
    for (const candidateId of candidateIds) await jobs.send("duplicate.cleanup", { candidateId }, { singletonKey: `duplicate-cleanup:${candidateId}`, retryLimit: 5, retryDelay: 15 });
    return { accepted: candidateIds.length };
  };
  app.post<{ Params: { id: string } }>("/api/v1/cleanup-candidates/:id/confirm", async (request, reply) => {
    await requireAuth(request.headers);
    const ids = await repository.listPendingIds([request.params.id]);
    if (ids.length === 0) throw new AppError("NOT_FOUND", "Cleanup candidate was not found or is no longer pending.");
    return reply.status(202).send(await enqueue(ids));
  });
  app.post<{ Body: { candidateIds?: unknown } }>("/api/v1/cleanup-candidates/confirm-all", async (request, reply) => {
    await requireAuth(request.headers);
    const candidateIds = request.body?.candidateIds;
    if (!Array.isArray(candidateIds) || candidateIds.length === 0 || candidateIds.some((id) => typeof id !== "string" || !id.trim())) {
      throw new AppError("VALIDATION_ERROR", "candidateIds must contain the fixed cleanup preview IDs being confirmed.");
    }
    const ids = await repository.listPendingIds(candidateIds);
    return reply.status(202).send(await enqueue(ids));
  });
}
