import type { ImportSearchChannelsRequest, SearchChannelOrderRequest, SearchChannelRequest, UpdateSearchChannelRequest } from "@follow115/contracts";
import type { FastifyInstance } from "fastify";
import type { SearchChannelService } from "./search-channel-service.js";

export function registerSearchChannelRoutes(app: FastifyInstance, service: SearchChannelService, requireAuth: (headers: Record<string, string | string[] | undefined>) => Promise<unknown>): void {
  app.get("/api/v1/search-channels", async (request) => { await requireAuth(request.headers); return { items: await service.list(), nextCursor: null }; });
  app.post<{ Body: SearchChannelRequest }>("/api/v1/search-channels", async (request) => { await requireAuth(request.headers); return service.create(request.body); });
  // Static actions must remain above /:id routes so Fastify cannot treat them as identifiers.
  app.put<{ Body: SearchChannelOrderRequest }>("/api/v1/search-channels/order", async (request) => { await requireAuth(request.headers); return service.saveOrder(request.body?.ids); });
  app.post<{ Body: ImportSearchChannelsRequest }>("/api/v1/search-channels/import", async (request) => { await requireAuth(request.headers); return service.import(request.body); });
  app.post("/api/v1/search-channels/check-all", async (request) => { await requireAuth(request.headers); return service.checkAll(); });
  app.patch<{ Params: { id: string }; Body: UpdateSearchChannelRequest }>("/api/v1/search-channels/:id", async (request) => { await requireAuth(request.headers); return service.update(request.params.id, request.body); });
  app.delete<{ Params: { id: string } }>("/api/v1/search-channels/:id", async (request, reply) => { await requireAuth(request.headers); await service.delete(request.params.id); return reply.status(204).send(); });
  app.post<{ Params: { id: string } }>("/api/v1/search-channels/:id/check", async (request) => { await requireAuth(request.headers); return service.check(request.params.id); });
}
