import { tool, type ToolSet } from "ai";
import { z } from "zod";

export function createTools(fetcher: Fetcher, hostname: string): ToolSet {
  return {
    searchNodes: tool({
      description:
        "Search nodes in the Lapidary Knowledge Graph by type and keyword. Returns Rubyists, CoreModules, or Stdlibs.",
      inputSchema: z.object({
        type: z
          .enum(["Rubyist", "CoreModule", "Stdlib"])
          .optional()
          .describe("Filter by node type"),
        query: z.string().optional().describe("Keyword to search for"),
      }),
      execute: async ({ type, query }) => {
        const params = new URLSearchParams();
        if (type) params.set("type", type);
        if (query) params.set("query", query);

        try {
          const response = await fetcher.fetch(
            `http://${hostname}/graph/nodes?${params.toString()}`,
          );

          if (response.ok) {
            return await response.json();
          }

          if (response.status === 400) {
            return { error: "Invalid parameters provided." };
          }

          return { error: "Service is temporarily unavailable." };
        } catch {
          return { error: "Service is unreachable." };
        }
      },
    }),

    getNeighbors: tool({
      description:
        "Get all nodes connected to a given node with their relationships. Use node IDs like Rubyist://matz, CoreModule://String, Stdlib://json.",
      inputSchema: z.object({
        nodeId: z
          .string()
          .describe("Node ID (e.g., Rubyist://matz, CoreModule://String)"),
        direction: z
          .enum(["outbound", "inbound", "both"])
          .optional()
          .describe("Relationship direction filter"),
      }),
      execute: async ({ nodeId, direction }) => {
        const params = new URLSearchParams();
        params.set("nodeId", nodeId);
        if (direction) params.set("direction", direction);

        try {
          const response = await fetcher.fetch(
            `http://${hostname}/graph/neighbors?${params.toString()}`,
          );

          if (response.ok) {
            return await response.json();
          }

          if (response.status === 400) {
            return { error: "Invalid parameters provided." };
          }

          if (response.status === 404) {
            return { error: "The requested node does not exist." };
          }

          return { error: "Service is temporarily unavailable." };
        } catch {
          return { error: "Service is unreachable." };
        }
      },
    }),
  };
}
