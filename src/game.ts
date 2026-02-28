// ─── Types ───────────────────────────────────────────────────────────────────

export const GRID_SIZE = 9;
export const NUM_COLORS = 7;
export const SPAWN_COUNT = 3;
export const MIN_LINE = 5; // minimum cells in a line to score

export type CellColor = number; // 0..NUM_COLORS-1,  -1 = empty

export interface Cell {
    color: CellColor;
}

export interface Position {
    row: number;
    col: number;
}

export type Grid = Cell[][];

// ─── Grid helpers ────────────────────────────────────────────────────────────

export function createEmptyGrid(): Grid {
    const grid: Grid = [];
    for (let r = 0; r < GRID_SIZE; r++) {
        grid[r] = [];
        for (let c = 0; c < GRID_SIZE; c++) {
            grid[r][c] = { color: -1 };
        }
    }
    return grid;
}

export function isEmpty(grid: Grid, pos: Position): boolean {
    return grid[pos.row][pos.col].color === -1;
}

export function getEmptyCells(grid: Grid): Position[] {
    const empty: Position[] = [];
    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            if (grid[r][c].color === -1) empty.push({ row: r, col: c });
        }
    }
    return empty;
}

// ─── Random ──────────────────────────────────────────────────────────────────

export function randomColor(): CellColor {
    return Math.floor(Math.random() * NUM_COLORS);
}

export function generateNextColors(): CellColor[] {
    return Array.from({ length: SPAWN_COUNT }, () => randomColor());
}

/** Place `count` random colored cells; returns positions placed. */
export function spawnCells(grid: Grid, nextColors: CellColor[]): Position[] {
    const empty = getEmptyCells(grid);
    const placed: Position[] = [];
    for (let i = 0; i < nextColors.length && empty.length > 0; i++) {
        const idx = Math.floor(Math.random() * empty.length);
        const pos = empty.splice(idx, 1)[0];
        grid[pos.row][pos.col].color = nextColors[i];
        placed.push(pos);
    }
    return placed;
}

// ─── Path-finding (BFS) ─────────────────────────────────────────────────────

const DIRS4: [number, number][] = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
];

export function findPath(grid: Grid, from: Position, to: Position): Position[] | null {
    if (from.row === to.row && from.col === to.col) return [];
    if (!isEmpty(grid, to)) return null;

    const visited: boolean[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));
    const parent: (Position | null)[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));

    visited[from.row][from.col] = true;
    const queue: Position[] = [from];

    while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const [dr, dc] of DIRS4) {
            const nr = cur.row + dr;
            const nc = cur.col + dc;
            if (nr < 0 || nr >= GRID_SIZE || nc < 0 || nc >= GRID_SIZE) continue;
            if (visited[nr][nc]) continue;
            // Can walk through empty cells + the source cell itself
            const isSource = nr === from.row && nc === from.col;
            if (!isSource && grid[nr][nc].color !== -1) continue;

            visited[nr][nc] = true;
            parent[nr][nc] = cur;

            if (nr === to.row && nc === to.col) {
                // Reconstruct path
                const path: Position[] = [];
                let p: Position | null = { row: nr, col: nc };
                while (p && !(p.row === from.row && p.col === from.col)) {
                    path.push(p);
                    p = parent[p.row][p.col];
                }
                return path.reverse();
            }

            queue.push({ row: nr, col: nc });
        }
    }
    return null;
}

// ─── Line detection ──────────────────────────────────────────────────────────

const DIRECTIONS: [number, number][] = [
    [0, 1], // horizontal
    [1, 0], // vertical
    [1, 1], // diagonal ↘
    [1, -1], // diagonal ↙
];

/**
 * After a move, check if any lines of MIN_LINE+ same-colored cells exist.
 * Returns the set of positions to remove and the score earned.
 */
export function checkLines(grid: Grid): { toRemove: Set<string>; score: number } {
    const toRemove = new Set<string>();

    for (let r = 0; r < GRID_SIZE; r++) {
        for (let c = 0; c < GRID_SIZE; c++) {
            const color = grid[r][c].color;
            if (color === -1) continue;

            for (const [dr, dc] of DIRECTIONS) {
                const line: Position[] = [{ row: r, col: c }];
                let nr = r + dr;
                let nc = c + dc;
                while (nr >= 0 && nr < GRID_SIZE && nc >= 0 && nc < GRID_SIZE && grid[nr][nc].color === color) {
                    line.push({ row: nr, col: nc });
                    nr += dr;
                    nc += dc;
                }

                if (line.length >= MIN_LINE) {
                    for (const p of line) {
                        toRemove.add(`${p.row},${p.col}`);
                    }
                }
            }
        }
    }

    const score = toRemove.size > 0 ? toRemove.size * 2 : 0;
    return { toRemove, score };
}

export function removeMatches(grid: Grid, toRemove: Set<string>): void {
    for (const key of toRemove) {
        const [r, c] = key.split(",").map(Number);
        grid[r][c].color = -1;
    }
}

// ─── Game-over check ─────────────────────────────────────────────────────────

export function isBoardFull(grid: Grid): boolean {
    return getEmptyCells(grid).length === 0;
}
