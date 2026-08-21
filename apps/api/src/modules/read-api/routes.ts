import { AppError } from "@follow115/contracts";
import type { FastifyInstance } from "fastify";
import type { ReadRepository } from "./mock-read-repository.js";

interface PageQuery { cursor?: string; limit?: string; }
interface SearchQuery extends PageQuery { q?: string; }

function pageQuery(query: PageQuery): { cursor: string | undefined; limit: number } {
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new AppError("VALIDATION_ERROR", "limit must be an integer between 1 and 50.");
  }
  if (query.cursor !== undefined && query.cursor.trim() === "") {
    throw new AppError("VALIDATION_ERROR", "cursor must not be empty.");
  }
  return { cursor: query.cursor, limit };
}

export function registerReadRoutes(app: FastifyInstance, repository: ReadRepository): void {
  app.get<{ Querystring: PageQuery }>("/api/v1/media/discover", async (request) => {
    const { cursor, limit } = pageQuery(request.query);
    return repository.discoverMedia(cursor, limit);
  });
  app.get<{ Querystring: SearchQuery }>("/api/v1/media/search", async (request) => {
    const query = request.query.q;
    if (typeof query !== "string" || query.trim() === "") throw new AppError("VALIDATION_ERROR", "q must not be empty.");
    const { cursor, limit } = pageQuery(request.query);
    return repository.searchMedia(query.trim(), cursor, limit);
  });
  app.get<{ Params: { id: string } }>("/api/v1/media/:id", async (request) => {
    const media = await repository.getMedia(request.params.id);
    if (media === null) throw new AppError("NOT_FOUND", "Media was not found.");
    return media;
  });
  app.get<{ Querystring: PageQuery }>("/api/v1/subscriptions", async (request) => {
    const { cursor, limit } = pageQuery(request.query);
    return repository.listSubscriptions(cursor, limit);
  });
  app.get<{ Params: { id: string } }>("/api/v1/subscriptions/:id", async (request) => {
    const subscription = await repository.getSubscription(request.params.id);
    if (subscription === null) throw new AppError("NOT_FOUND", "Subscription was not found.");
    return subscription;
  });
}
