import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { WORLD } from "./test/world-fixture.ts";

// Tests run inside the Workers runtime with a local D1 database. Requests to the site for
// world/index.json are answered with a small fixture world instead of going to the internet.
export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SITE_URL: "https://site.test",
            FAKE_NOW: "2026-10-17T10:00:00Z", // a Saturday
          },
          outboundService: async (request: Request) => {
            if (new URL(request.url).pathname === "/world/index.json") {
              return new Response(JSON.stringify(WORLD), { headers: { "Content-Type": "application/json" } });
            }
            return new Response("not found", { status: 404 });
          },
        },
      }),
    ],
    test: { setupFiles: ["./test/setup.ts"] },
  };
});
