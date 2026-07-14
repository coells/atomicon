export const GRID_SIZE = 9;
export const HEX_RADIUS = 4;
export const VALID_CELL_COUNT = 60;
export const NUM_COLORS = 7;
export const JOKER_COLOR = NUM_COLORS;
export const EMPTY_COLOR = -1;
export const BLOCKED_COLOR = -2;
export const MIN_MATCH = 5;
export const PREVIEW_SIZE = 5;

export type CellColor = number;

export interface Cell {
    color: CellColor;
}

export interface Position {
    row: number;
    col: number;
}

export type Grid = Cell[][];

const HEX_DIRS: [number, number][] = [
    [1, 0],
    [1, -1],
    [0, -1],
    [-1, 0],
    [-1, 1],
    [0, 1],
];

/** Flat cell index — the canonical position key across game logic and rendering. */
export function cellIndex(pos: Position): number {
    return pos.row * GRID_SIZE + pos.col;
}

export function isValidCell(pos: Position): boolean {
    if (pos.row < 0 || pos.row >= GRID_SIZE || pos.col < 0 || pos.col >= GRID_SIZE) {
        return false;
    }
    const q = pos.col - HEX_RADIUS;
    const r = pos.row - HEX_RADIUS;
    const s = -q - r;
    if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > HEX_RADIUS) return false;
    // Remove the central cell
    if (q === 0 && r === 0) return false;
    return true;
}

// The board never changes shape — precompute valid positions and the
// neighbor table once so per-move logic (BFS, line checks) never re-derives them.
export const ALL_VALID_POSITIONS: Position[] = (() => {
    const positions: Position[] = [];
    for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
            const pos = { row, col };
            if (isValidCell(pos)) positions.push(pos);
        }
    }
    return positions;
})();

const NEIGHBOR_TABLE: Position[][] = (() => {
    const table: Position[][] = Array.from({ length: GRID_SIZE * GRID_SIZE }, () => []);
    for (const pos of ALL_VALID_POSITIONS) {
        const list = table[cellIndex(pos)];
        for (const [dq, dr] of HEX_DIRS) {
            const next = { row: pos.row + dr, col: pos.col + dq };
            if (isValidCell(next)) list.push(next);
        }
    }
    return table;
})();

export function createEmptyGrid(): Grid {
    const grid: Grid = [];
    for (let row = 0; row < GRID_SIZE; row++) {
        grid[row] = [];
        for (let col = 0; col < GRID_SIZE; col++) {
            const pos = { row, col };
            grid[row][col] = { color: isValidCell(pos) ? EMPTY_COLOR : BLOCKED_COLOR };
        }
    }
    return grid;
}

export function isEmpty(grid: Grid, pos: Position): boolean {
    return isValidCell(pos) && grid[pos.row][pos.col].color === EMPTY_COLOR;
}

export function getEmptyCells(grid: Grid): Position[] {
    const empty: Position[] = [];
    for (const pos of ALL_VALID_POSITIONS) {
        if (grid[pos.row][pos.col].color === EMPTY_COLOR) empty.push(pos);
    }
    return empty;
}

export function countOccupied(grid: Grid): number {
    let occupied = 0;
    for (const pos of ALL_VALID_POSITIONS) {
        if (grid[pos.row][pos.col].color >= 0) occupied++;
    }
    return occupied;
}

function jokerChance(moveCount: number): number {
    return Math.min(0.05, 0.01 + moveCount * 0.0006);
}

function randomColor(moveCount: number): CellColor {
    if (Math.random() < jokerChance(moveCount)) return JOKER_COLOR;
    return Math.floor(Math.random() * NUM_COLORS);
}

export function generateNextColors(count: number, moveCount: number): CellColor[] {
    return Array.from({ length: count }, () => randomColor(moveCount));
}

export function getSpawnCount(moveCount: number, occupiedRatio: number): number {
    if (moveCount < 10 && occupiedRatio < 0.58) return 3;
    if (moveCount < 25 && occupiedRatio < 0.82) return 4;
    return 5;
}

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

function neighbors(pos: Position): Position[] {
    return NEIGHBOR_TABLE[cellIndex(pos)];
}

function createVisitedGrid(): boolean[][] {
    return Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(false));
}

export function findPath(grid: Grid, from: Position, to: Position): Position[] | null {
    if (!isValidCell(from) || !isValidCell(to)) return null;
    if (from.row === to.row && from.col === to.col) return [];
    if (!isEmpty(grid, to)) return null;

    const visited = createVisitedGrid();
    const parent: (Position | null)[][] = Array.from({ length: GRID_SIZE }, () => Array(GRID_SIZE).fill(null));

    const queue: Position[] = [from];
    visited[from.row][from.col] = true;

    let head = 0;
    while (head < queue.length) {
        const cur = queue[head++];
        for (const next of neighbors(cur)) {
            if (visited[next.row][next.col]) continue;
            const isSource = next.row === from.row && next.col === from.col;
            if (!isSource && grid[next.row][next.col].color !== EMPTY_COLOR) continue;

            visited[next.row][next.col] = true;
            parent[next.row][next.col] = cur;

            if (next.row === to.row && next.col === to.col) {
                const path: Position[] = [];
                let p: Position | null = to;
                while (p && !(p.row === from.row && p.col === from.col)) {
                    path.push(p);
                    p = parent[p.row][p.col];
                }
                return path.reverse();
            }

            queue.push(next);
        }
    }
    return null;
}

function collectGroupForBase(
    grid: Grid,
    start: Position,
    baseColor: number,
    visited: boolean[][],
): { group: Position[]; baseCount: number } {
    const group: Position[] = [];
    let baseCount = 0;

    const queue: Position[] = [start];
    visited[start.row][start.col] = true;

    let head = 0;
    while (head < queue.length) {
        const current = queue[head++];
        const color = grid[current.row][current.col].color;
        group.push(current);

        if (color === baseColor) baseCount++;

        for (const next of neighbors(current)) {
            if (visited[next.row][next.col]) continue;
            const nextColor = grid[next.row][next.col].color;
            if (nextColor !== baseColor && nextColor !== JOKER_COLOR) continue;
            visited[next.row][next.col] = true;
            queue.push(next);
        }
    }

    return { group, baseCount };
}

export function checkLines(grid: Grid): { toRemove: Set<number>; score: number } {
    const toRemove = new Set<number>();
    let lineCount = 0;

    const visitedByBase = Array.from({ length: NUM_COLORS }, () => createVisitedGrid());

    for (const pos of ALL_VALID_POSITIONS) {
        const color = grid[pos.row][pos.col].color;
        if (color < 0 || color === JOKER_COLOR) continue;

        const baseColor = color;
        const visited = visitedByBase[baseColor];
        if (visited[pos.row][pos.col]) continue;

        const { group, baseCount } = collectGroupForBase(grid, pos, baseColor, visited);
        if (group.length >= MIN_MATCH && baseCount > 0) {
            // A qualifying group always contributes new cells: base-colored cells
            // are only reachable by their own color's BFS, and visitedByBase
            // prevents re-collection (jokers shared between groups just dedupe).
            for (const groupPos of group) toRemove.add(cellIndex(groupPos));
            lineCount++;
        }
    }

    let jokerRemoved = 0;
    for (const idx of toRemove) {
        if (grid[Math.floor(idx / GRID_SIZE)][idx % GRID_SIZE].color === JOKER_COLOR) jokerRemoved++;
    }

    const baseScore = toRemove.size * 2;
    const lengthBonus = Math.max(0, toRemove.size - MIN_MATCH) * 2;
    const multiLineBonus = lineCount > 1 ? (lineCount - 1) * 6 : 0;
    const jokerBonus = jokerRemoved * 2;

    return {
        toRemove,
        score: toRemove.size > 0 ? baseScore + lengthBonus + multiLineBonus + jokerBonus : 0,
    };
}

export function removeMatches(grid: Grid, toRemove: Set<number>): void {
    for (const idx of toRemove) {
        grid[Math.floor(idx / GRID_SIZE)][idx % GRID_SIZE].color = EMPTY_COLOR;
    }
}

export function hasAnyMove(grid: Grid): boolean {
    for (const pos of ALL_VALID_POSITIONS) {
        if (grid[pos.row][pos.col].color < 0) continue;
        for (const next of neighbors(pos)) {
            if (grid[next.row][next.col].color === EMPTY_COLOR) return true;
        }
    }
    return false;
}
