import { expect, test, type Page } from "@playwright/test";
import { ALL_VALID_POSITIONS, type Position } from "../src/game";

// Script only the initial deal through the randomness boundary, not game state.
// Four fire characters are connected, with their fifth friend on the opposite edge.
const initialPositions = [
    { row: 0, col: 4 },
    { row: 0, col: 5 },
    { row: 0, col: 6 },
    { row: 0, col: 7 },
    { row: 8, col: 0 },
    { row: 8, col: 4 },
];
const remaining = [...ALL_VALID_POSITIONS];
const deal = [2, 3, 4, 2, 3, 0, 0, 0, 0, 0, 1].flatMap((color) => [0.5, (color + 0.1) / 7]);
for (const pos of initialPositions) {
    const index = remaining.findIndex((candidate) => candidate.row === pos.row && candidate.col === pos.col);
    deal.push((index + 0.1) / remaining.length);
    remaining.splice(index, 1);
}

async function point(page: Page, pos: Position) {
    const box = await page.locator("#game-canvas").boundingBox();
    if (!box) throw new Error("Board is not visible");
    const radius = (box.width - Math.min(3, box.width * 0.068) * 2) / (Math.sqrt(3) * 8 + 2.2);
    return {
        x: box.width / 2 + Math.sqrt(3) * (pos.col - 4 + (pos.row - 4) / 2) * radius,
        y: box.height / 2 + 1.5 * (pos.row - 4) * radius,
    };
}

async function choose(page: Page, pos: Position) {
    await page.locator("#game-canvas").click({ position: await point(page, pos) });
}

test.beforeEach(async ({ page }) => {
    await page.addInitScript((values) => {
        let index = 0;
        const random = Math.random;
        Math.random = () => values[index++] ?? random();
    }, deal);
    await page.goto("/");
    // The spawn animation is real; use the rendered message, not a delay.
    await expect(page.locator("#space-count")).toHaveText("54");
    await expect
        .poll(async () => {
            await choose(page, initialPositions[4]);
            return page.locator("#message").textContent();
        })
        .toContain("Fire selected");
});

test("a clear scores, removes five cells, and preserves records after restarting", async ({ page }) => {
    await choose(page, { row: 0, col: 8 });
    await expect(page.locator("#score")).toHaveText("10");
    await expect(page.locator("#best")).toHaveText("10");
    await expect(page.locator("#space-count")).toHaveText("59");
    await expect(page.locator("#message")).toContainText("5 together");
    await page.locator("#new-game-btn").click();
    await expect(page.locator("#restart-confirm")).toBeVisible();
    await page.getByRole("button", { name: "Keep playing" }).click();
    await expect(page.locator("#score")).toHaveText("10");
    await page.locator("#new-game-btn").click();
    await page.locator("#confirm-restart-btn").click();
    await expect(page.locator("#score")).toHaveText("0");
    await expect(page.locator("#best")).toHaveText("10");
    await expect(page.locator("#space-count")).toHaveText("54");
    await expect(page.locator("#turn-count")).toHaveText("MOVE 01");
});

test("keyboard movement spawns the preview and Escape deselects", async ({ page }) => {
    await page.locator("#game-canvas").press("Escape");
    await expect(page.locator("#message")).toContainText("Choose a creature");
    await choose(page, initialPositions[4]);
    await page.locator("#game-canvas").press("ArrowRight");
    await expect(page.locator("#message")).toContainText("Empty space");
    await page.locator("#game-canvas").press("Enter");
    await expect(page.locator("#turn-count")).toHaveText("MOVE 02");
    await expect(page.locator("#space-count")).toHaveText("51");
    await expect(page.locator("#score")).toHaveText("0");
});

test("a full session ends with a record and can be replayed", async ({ page }, testInfo) => {
    await page.keyboard.press("m");
    await page.clock.install();
    await page.locator("#game-canvas").press("Escape");
    for (let turn = 0; turn < 100 && !(await page.locator("#game-end").isVisible()); turn++) {
        const moved = await page.evaluate((positions) => {
            const canvas = document.getElementById("game-canvas");
            if (!(canvas instanceof HTMLCanvasElement)) throw new Error("Missing canvas");
            const box = canvas.getBoundingClientRect();
            const radius = (box.width - Math.min(3, box.width * 0.068) * 2) / (Math.sqrt(3) * 8 + 2.2);
            const click = (pos: Position) =>
                canvas.dispatchEvent(
                    new MouseEvent("click", {
                        bubbles: true,
                        clientX: box.x + box.width / 2 + Math.sqrt(3) * (pos.col - 4 + (pos.row - 4) / 2) * radius,
                        clientY: box.y + box.height / 2 + 1.5 * (pos.row - 4) * radius,
                    }),
                );
            const deselect = () => canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            // Drive only public input and live feedback; don't mutate the model.
            for (const source of positions) {
                deselect();
                click(source);
                if (!document.getElementById("message")?.textContent?.includes("selected.")) continue;
                for (const destination of positions) {
                    if (destination.row === source.row && destination.col === source.col) continue;
                    // Clicking an occupied destination reselects it. Restore the
                    // intended source before testing the next possible path.
                    deselect();
                    click(source);
                    click(destination);
                    if (document.getElementById("message")?.textContent?.includes("Making a little")) return true;
                }
            }
            return false;
        }, ALL_VALID_POSITIONS);
        expect(moved).toBe(true);
        await expect
            .poll(async () => {
                await page.clock.runFor(300);
                return page.locator("#game-canvas").getAttribute("aria-busy");
            })
            .toBe("false");
    }
    await expect(page.locator("#game-end")).toBeVisible();
    await expect(page.locator("#top-scores li")).toHaveCount(1);
    await expect(page.locator("#top-scores li.current")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("completed-constellation.png"), fullPage: true });
    await page.locator("#play-again-btn").click();
    await page.clock.runFor(500);
    await expect(page.locator("#game-end")).not.toBeVisible();
    await expect(page.locator("#space-count")).toHaveText("54");
    await expect(page.locator("#turn-count")).toHaveText("MOVE 01");
});

test("restarting during a lightning clear cancels its pending removal", async ({ page }) => {
    await page.clock.install();
    await page.clock.pauseAt(Date.now() + 1000);
    await choose(page, { row: 0, col: 8 });
    await expect
        .poll(async () => {
            await page.clock.runFor(50);
            return page.locator("#score").textContent();
        })
        .toBe("10");
    await expect(page.locator("#game-canvas")).toHaveAttribute("aria-busy", "true");
    await expect(page.locator("#space-count")).toHaveText("54");
    await page.locator("#new-game-btn").click();
    await page.locator("#confirm-restart-btn").click();
    await page.clock.runFor(1500);
    await expect(page.locator("#game-canvas")).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("#score")).toHaveText("0");
    await expect(page.locator("#space-count")).toHaveText("54");
    await expect(page.locator("#turn-count")).toHaveText("MOVE 01");
});

test("a restart during a long move cannot deliver an old animation callback", async ({ page }) => {
    await choose(page, { row: 0, col: 8 });
    await page.locator("#new-game-btn").click();
    await page.locator("#confirm-restart-btn").click();
    await expect(page.locator("#turn-count")).toHaveText("MOVE 01");
    await expect(page.locator("#space-count")).toHaveText("54");
    // Wait through the longest possible original animation before asserting.
    await page.clock.install();
    await page.clock.runFor(2000);
    await expect(page.locator("#turn-count")).toHaveText("MOVE 01");
    await expect(page.locator("#space-count")).toHaveText("54");
    await expect(page.locator("#score")).toHaveText("0");
});
