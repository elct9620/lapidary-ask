import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ["discord-api-types/v10", "discord-interactions"],
        },
      },
    },
    coverage: {
      enabled: true,
      provider: "istanbul",
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/commands.ts"],
    },
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.jsonc",
        },
      },
    },
  },
});
