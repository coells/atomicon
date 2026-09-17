type ParticleShape = "ember" | "crystal" | "leaf" | "sun" | "wisp" | "petal" | "grain" | "star";

/** Sampled once per particle, never randomized during drawing. */
export interface ParticleMotion {
    phase: number;
    spin: number;
    rise: number;
    flutter: number;
    flutterRate: number;
}

interface ParticleStyle {
    shape: ParticleShape;
    color: string;
    highlight: string;
    rise: number;
    flutter: number;
    turn: number;
}

// Same order as CHARACTER_NAMES. Elemental motion sits on top of each particle's own curve.
const STYLES: readonly ParticleStyle[] = [
    { shape: "ember", color: "#ff9a49", highlight: "#ffe4a0", rise: 0.28, flutter: 0.04, turn: 0.1 },
    { shape: "crystal", color: "#71d8ff", highlight: "#e0faff", rise: 0.08, flutter: 0, turn: 0.3 },
    { shape: "leaf", color: "#91d65a", highlight: "#dbf5a8", rise: -0.08, flutter: 0.12, turn: 0.8 },
    { shape: "sun", color: "#ffd05c", highlight: "#fff1b8", rise: 0.12, flutter: 0, turn: 0.2 },
    { shape: "wisp", color: "#b28aef", highlight: "#e5d6ff", rise: 0.2, flutter: 0.1, turn: 0.5 },
    { shape: "petal", color: "#f6a0cc", highlight: "#ffe0ef", rise: -0.1, flutter: 0.14, turn: 0.9 },
    { shape: "grain", color: "#dfba7b", highlight: "#ffebbc", rise: -0.16, flutter: 0.02, turn: 0.6 },
    { shape: "star", color: "#e2bbff", highlight: "#fff0ae", rise: 0.12, flutter: 0.06, turn: 0.3 },
];

/** Eight small cached paintings; no image assets or per-frame path construction. */
export class ElementParticles {
    private cache: HTMLCanvasElement[] = [];

    draw(
        ctx: CanvasRenderingContext2D,
        color: number,
        x: number,
        y: number,
        radius: number,
        progress: number,
        motion: ParticleMotion,
    ) {
        const style = STYLES[color];
        const sprite = this.cache[color] ?? (this.cache[color] = this.paint(style));
        // A CSS-pixel floor keeps the silhouette readable on a phone's small hexes.
        // Canvas DPR improves sharpness, not the on-screen size of the particle.
        const size = Math.max(3.6, radius * 0.1) * (1 - progress * 0.15);
        const sway =
            (Math.sin(motion.phase + progress * Math.PI * motion.flutterRate) - Math.sin(motion.phase)) *
            style.flutter *
            motion.flutter;
        ctx.save();
        ctx.translate(x + sway * radius, y - progress * radius * style.rise * motion.rise);
        ctx.rotate(style.turn * (motion.phase + progress * motion.spin));
        const extent = size * 1.8;
        ctx.drawImage(sprite, -extent, -extent, extent * 2, extent * 2);
        ctx.restore();
    }

    private paint(style: ParticleStyle): HTMLCanvasElement {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext("2d")!;
        ctx.translate(32, 32);
        const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 32);
        glow.addColorStop(0, style.color + "55");
        glow.addColorStop(1, style.color + "00");
        ctx.fillStyle = glow;
        ctx.fillRect(-32, -32, 64, 64);
        ctx.fillStyle = style.color;
        ctx.strokeStyle = style.highlight;
        ctx.lineWidth = 1.8;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.beginPath();
        switch (style.shape) {
            case "ember":
                ctx.moveTo(0, -19);
                ctx.bezierCurveTo(2, -7, 11, -2, 9, 7);
                ctx.bezierCurveTo(6, 18, -9, 17, -9, 6);
                ctx.bezierCurveTo(-9, -3, -2, -6, 0, -19);
                break;
            case "crystal":
                ctx.moveTo(0, -19);
                ctx.lineTo(11, -3);
                ctx.lineTo(0, 19);
                ctx.lineTo(-11, 3);
                break;
            case "leaf":
                ctx.moveTo(-13, 14);
                ctx.bezierCurveTo(-19, -5, -1, -17, 14, -15);
                ctx.bezierCurveTo(19, 2, 4, 18, -13, 14);
                break;
            case "sun":
            case "star": {
                const points = style.shape === "sun" ? 4 : 5;
                for (let i = 0; i < points * 2; i++) {
                    const angle = (i * Math.PI) / points - Math.PI / 2;
                    const length = i % 2 === 0 ? 18 : 6;
                    const x = Math.cos(angle) * length;
                    const y = Math.sin(angle) * length;
                    if (i === 0) ctx.moveTo(x, y);
                    else ctx.lineTo(x, y);
                }
                break;
            }
            case "wisp":
                ctx.moveTo(8, -18);
                ctx.bezierCurveTo(-17, -12, -20, 12, 0, 17);
                ctx.bezierCurveTo(13, 20, 17, 7, 11, 3);
                ctx.bezierCurveTo(12, 16, -8, 11, -6, 1);
                ctx.bezierCurveTo(-5, -8, 1, -12, 8, -18);
                break;
            case "petal":
                ctx.moveTo(0, 18);
                ctx.bezierCurveTo(-5, 9, -18, -2, -10, -13);
                ctx.bezierCurveTo(-2, -23, 17, -10, 12, 1);
                ctx.bezierCurveTo(9, 9, 3, 12, 0, 18);
                break;
            case "grain":
                ctx.moveTo(-11, -10);
                ctx.lineTo(6, -14);
                ctx.lineTo(14, -1);
                ctx.lineTo(6, 12);
                ctx.lineTo(-10, 9);
                ctx.lineTo(-15, 0);
                break;
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // A single vein/facet reads better at phone size than detailed textures.
        ctx.beginPath();
        switch (style.shape) {
            case "leaf":
                ctx.moveTo(-10, 11);
                ctx.quadraticCurveTo(-1, 0, 10, -11);
                break;
            case "crystal":
                ctx.moveTo(0, -14);
                ctx.lineTo(-2, 2);
                ctx.lineTo(0, 14);
                ctx.moveTo(-8, 3);
                ctx.lineTo(8, -3);
                break;
            case "ember":
                ctx.moveTo(0, 10);
                ctx.quadraticCurveTo(-4, 4, 0, -3);
                break;
            case "grain":
                ctx.moveTo(-8, -7);
                ctx.lineTo(3, -9);
                break;
            default:
                ctx.moveTo(-2, -3);
                ctx.lineTo(1, 1);
                break;
        }
        ctx.stroke();
        return canvas;
    }
}
