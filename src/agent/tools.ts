import { tool } from "ai";
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

async function fetchFromGraph(fetcher: Fetcher, url: string): Promise<unknown> {
  try {
    const response = await fetcher.fetch(url);

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
}

export function createTools(fetcher: Fetcher, baseUrl: string) {
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

        return fetchFromGraph(
          fetcher,
          `${baseUrl}/graph/nodes?${params.toString()}`,
        );
      },
    }),

    getNeighbors: tool({
      description:
        "Get all nodes connected to a given node with their relationships. Use node IDs like rubyist://matz, coremodule://String, stdlib://json.",
      inputSchema: z.object({
        nodeId: z
          .string()
          .describe("Node ID (e.g., rubyist://matz, coremodule://String)"),
      }),
      execute: async ({ nodeId }) => {
        const params = new URLSearchParams();
        params.set("node_id", normalizeNodeId(nodeId));
        params.set("direction", "both");

        return fetchFromGraph(
          fetcher,
          `${baseUrl}/graph/neighbors?${params.toString()}`,
        );
      },
    }),
  };
}
