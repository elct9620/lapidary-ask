import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    coverage: {
      enabled: true,
      provider: "istanbul",
      reportsDirectory: "coverage",
      include: ["src/**/*.ts"],
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
