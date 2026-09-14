import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./tests",
    testIgnore: "**/production.spec.ts",
    fullyParallel: true,
    use: { baseURL: "http://127.0.0.1:4173", trace: "retain-on-failure" },
    projects: [
        { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } } },
        { name: "mobile", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" } },
        { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
    ],
    webServer: {
        command: "pnpm dev --host 127.0.0.1 --port 4173 --strictPort",
        url: "http://127.0.0.1:4173",
        reuseExistingServer: !process.env.CI,
    },
});
