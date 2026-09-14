export const CHARACTER_NAMES = [
    "Fire",
    "Ice",
    "Leaf",
    "Sun",
    "Shadow",
    "Blossom",
    "Sandstone golem",
    "Cosmic wildcard",
];
const FALLBACK_COLORS = ["#ff503e", "#64d6ff", "#85df42", "#ffd246", "#ad5afa", "#ff86be", "#edcb8e", "#e8bdff"];
const TILE = 256;

/** One 2 MiB decoded atlas, shared by the board and the upcoming-piece strip. */
export class CharacterArt {
    private image = new Image();
    private loaded = false;

    constructor(onReady: () => void) {
        this.image.decoding = "async";
        this.image.src = `${import.meta.env.BASE_URL}characters/atlas.webp`;
        void this.image
            .decode()
            .then(() => {
                if (this.image.naturalWidth !== 1024 || this.image.naturalHeight !== 512)
                    throw new Error("Unexpected character atlas dimensions");
                this.loaded = true;
                onReady();
            })
            .catch((error) => {
                // Keep the puzzle playable if the asset cannot be loaded.
                console.warn("Character artwork unavailable:", error);
            });
    }

    draw(ctx: CanvasRenderingContext2D, color: number, x: number, y: number, size: number) {
        if (this.loaded) {
            ctx.drawImage(
                this.image,
                (color % 4) * TILE,
                Math.floor(color / 4) * TILE,
                TILE,
                TILE,
                x - size / 2,
                y - size / 2,
                size,
                size,
            );
            return;
        }
        ctx.fillStyle = FALLBACK_COLORS[color];
        ctx.beginPath();
        ctx.arc(x, y, size * 0.3, 0, Math.PI * 2);
        ctx.fill();
    }
}
