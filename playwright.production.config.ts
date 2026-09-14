import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

export default defineConfig(base, {
    testMatch: "**/production.spec.ts",
    testIgnore: [],
    use: { baseURL: "http://127.0.0.1:4174/atomicon/" },
    webServer: {
        command: "pnpm build && pnpm preview --host 127.0.0.1 --port 4174 --strictPort",
        url: "http://127.0.0.1:4174/atomicon/",
        reuseExistingServer: false,
    },
});
