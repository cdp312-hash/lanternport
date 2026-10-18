import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      TEST_MIGRATIONS: D1Migration[];
      SITE_URL: string;
      ALLOWED_ORIGINS: string;
      FAKE_NOW?: string;
    }
  }
}
