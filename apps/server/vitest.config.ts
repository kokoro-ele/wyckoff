import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The PostgreSQL integration suites truncate shared fixture tables.
    // Running them in parallel would make them destroy each other's data.
    fileParallelism: false,
  },
});
