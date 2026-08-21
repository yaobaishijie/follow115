import type { DiscoverHotResponse } from "@follow115/contracts";
import type { FastifyInstance } from "fastify";
import type { DiscoverService } from "./discover-service.js";

/** Public, read-only discovery endpoint. It deliberately has no 115 dependency. */
export function registerDiscoverRoutes(app: FastifyInstance, service: DiscoverService): void {
  app.get("/api/v1/discover/hot", async (): Promise<DiscoverHotResponse> => {
    const sections = await service.listHotSections();
    return {
      sections: sections.map(({ key, title, items }) => ({
        key,
        title,
        items: items.map((item) => ({ ...item }))
      }))
    };
  });
}
