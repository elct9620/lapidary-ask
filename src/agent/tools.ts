import { tool, type ToolSet } from "ai";
import { z } from "zod";

export function normalizeNodeId(nodeId: string): string {
  // Fix separator: "stdlib//irb" → "stdlib://irb"
  const normalized = nodeId.replace(/^([^:]+)\/\//, "$1://");
  // Lowercase type prefix: "Stdlib://irb" → "stdlib://irb"
  return normalized.replace(/^([^:]+):\/\//, (_, type) => {
    return `${type.toLowerCase()}://`;
  });
}

const typeNameMap: Record<string, string> = {
  rubyist: "Rubyist",
  coremodule: "CoreModule",
  stdlib: "Stdlib",
};

export function normalizeType(type: string): string {
  return typeNameMap[type.toLowerCase()] ?? type;
}

export function createTools(fetcher: Fetcher, baseUrl: string): ToolSet {
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
        if (type) params.set("type", normalizeType(type));
        if (query) params.set("q", query);

        try {
          const response = await fetcher.fetch(
            `${baseUrl}/graph/nodes?${params.toString()}`,
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
        "Get all nodes connected to a given node with their relationships. Use node IDs like rubyist://matz, coremodule://String, stdlib://json.",
      inputSchema: z.object({
        nodeId: z
          .string()
          .describe("Node ID (e.g., rubyist://matz, coremodule://String)"),
        direction: z
          .enum(["outbound", "inbound", "both"])
          .optional()
          .describe("Relationship direction filter"),
      }),
      execute: async ({ nodeId, direction }) => {
        const params = new URLSearchParams();
        params.set("node_id", normalizeNodeId(nodeId));
        if (direction) params.set("direction", direction);

        try {
          const response = await fetcher.fetch(
            `${baseUrl}/graph/neighbors?${params.toString()}`,
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
