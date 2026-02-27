import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "cursor-auto-otel": path.resolve(__dirname, "dist/index.js"),
    },
  },
  // Tests run against built output; run "npm run build" before "npm run test".
});
