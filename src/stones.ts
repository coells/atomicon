// Original vector stones: one cached sprite per color, animated by transforms.
const COLORS = ["#ff426e", "#299fff", "#77e63c", "#ffbc32", "#a568ff", "#ff72cf", "#28e5cf", "#a9f4ff"];
export const STONE_NAMES = [
    "Ruby diamond",
    "Blue bubble",
    "Green sprout",
    "Amber triangle",
    "Violet cross",
    "Pink heart",
    "Teal star",
    "Rainbow blob",
];

export function paintStone(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number, face = true) {
    const hue = COLORS[color];
    ctx.save();
    ctx.translate(x, y);
    // Rounded, tactile silhouettes remain distinguishable without color.
    const sides = [4, 16, 12, 3, 12, 4, 10, 16][color];
    const rotation = -Math.PI / 2;
    const cross = [
        [-0.46, -0.96],
        [0.46, -0.96],
        [0.46, -0.46],
        [0.96, -0.46],
        [0.96, 0.46],
        [0.46, 0.46],
        [0.46, 0.96],
        [-0.46, 0.96],
        [-0.46, 0.46],
        [-0.96, 0.46],
        [-0.96, -0.46],
        [-0.46, -0.46],
    ];
    const points = Array.from({ length: sides }, (_, i) => {
        const angle = rotation + (i * Math.PI * 2) / sides;
        if (color === 4) return { x: cross[i][0] * r, y: cross[i][1] * r };
        let radius = 1;
        if (color === 1 || color === 7) radius = 0.91 + 0.09 * Math.sin(angle * 3 + 0.6);
        if (color === 2) radius = 0.88 + 0.12 * Math.cos(angle * 4);
        if (color === 6) radius = i % 2 === 0 ? 1.12 : 0.59;
        return { x: Math.cos(angle) * r * radius, y: Math.sin(angle) * r * radius };
    });
    const trace = (scale: number) => {
        ctx.beginPath();
        if (color === 5) {
            const q = r * scale;
            ctx.moveTo(0, q * 0.88);
            ctx.bezierCurveTo(-q * 0.3, q * 0.64, -q * 0.94, q * 0.13, -q * 0.94, -q * 0.3);
            ctx.bezierCurveTo(-q * 0.94, -q * 0.92, -q * 0.25, -q * 0.98, 0, -q * 0.5);
            ctx.bezierCurveTo(q * 0.25, -q * 0.98, q * 0.94, -q * 0.92, q * 0.94, -q * 0.3);
            ctx.bezierCurveTo(q * 0.94, q * 0.13, q * 0.3, q * 0.64, 0, q * 0.88);
            ctx.closePath();
            return;
        }
        for (let i = 0; i < sides; i++) {
            const a = points[i],
                b = points[(i + 1) % sides];
            const mx = ((a.x + b.x) * scale) / 2,
                my = ((a.y + b.y) * scale) / 2;
            if (i === 0) ctx.moveTo(mx, my);
            else ctx.quadraticCurveTo(a.x * scale, a.y * scale, mx, my);
        }
        const a = points[0],
            b = points[1];
        ctx.quadraticCurveTo(a.x * scale, a.y * scale, ((a.x + b.x) * scale) / 2, ((a.y + b.y) * scale) / 2);
        ctx.closePath();
    };
    // Broad silhouettes with a small rounded bevel, not sharp tiny jewels.
    ctx.translate(0, r * 0.04);
    trace(1.01);
    ctx.fillStyle = "#030817aa";
    ctx.fill();
    ctx.translate(0, -r * 0.04);
    const body = ctx.createLinearGradient(-r, -r, r, r);
    body.addColorStop(0, "#f3ffff");
    body.addColorStop(0.18, hue);
    body.addColorStop(0.62, hue);
    body.addColorStop(1, "#192653");
    trace(1);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = hue;
    ctx.lineWidth = r * 0.075;
    ctx.stroke();
    ctx.save();
    trace(0.92);
    ctx.clip();
    const glow = ctx.createRadialGradient(-r * 0.28, -r * 0.42, 0, 0, 0, r);
    glow.addColorStop(0, "#ffffffaa");
    glow.addColorStop(0.5, "#ffffff00");
    glow.addColorStop(1, "#00082566");
    ctx.fillStyle = glow;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    if (color === 7) {
        for (let i = 0; i < 7; i++) {
            ctx.fillStyle = COLORS[i] + "99";
            ctx.beginPath();
            ctx.moveTo(0, 0);
            ctx.arc(0, 0, r, (i * Math.PI * 2) / 7, ((i + 1) * Math.PI * 2) / 7);
            ctx.fill();
        }
    }
    ctx.restore();
    trace(0.72);
    ctx.strokeStyle = "#ffffff30";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Leave the center free for the little character's expression.
    ctx.beginPath();
    ctx.ellipse(-r * 0.22, -r * 0.43, r * 0.22, r * 0.075, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = "#ffffffcc";
    ctx.fill();
    ctx.restore();
    if (face) paintFace(ctx, x, y, r, color, 0);
}

export function paintFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: number, time: number) {
    ctx.save();
    ctx.translate(x, y);
    const blink = Math.sin(time * 0.9 + color * 1.7) > 0.992;
    const eyeY = color === 3 ? 0.04 : -0.13;
    const eyeSize = color === 4 ? 0.23 : 0.21;
    for (const side of [-1, 1]) {
        const ex = side * r * 0.26,
            ey = eyeY * r;
        ctx.fillStyle = "#f5ffff";
        ctx.beginPath();
        ctx.ellipse(ex, ey, r * eyeSize, r * (blink ? 0.035 : eyeSize * 1.25), side * 0.12, 0, Math.PI * 2);
        ctx.fill();
        if (!blink) {
            ctx.fillStyle = "#142037";
            ctx.beginPath();
            ctx.ellipse(
                ex + Math.sin(time * 0.5 + color) * r * 0.045,
                ey + r * 0.035,
                r * 0.1,
                r * 0.14,
                0,
                0,
                Math.PI * 2,
            );
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(ex - r * 0.025, ey - r * 0.025, r * 0.036, 0, Math.PI * 2);
            ctx.fill();
        }
    }
    ctx.strokeStyle = "#16233e";
    ctx.lineWidth = r * 0.065;
    ctx.lineCap = "round";
    const my = r * (color === 3 ? 0.4 : 0.29);
    ctx.beginPath();
    ctx.moveTo(-r * 0.19, my);
    ctx.quadraticCurveTo(0, my + r * (color % 2 ? 0.05 : 0.22), r * 0.19, my - r * (color === 0 ? 0.08 : 0));
    ctx.stroke();
    if (color === 2 || color === 7) {
        ctx.fillStyle = "#fff";
        ctx.fillRect(-r * 0.05, my, r * 0.1, r * 0.1);
    }
    if (color === 4) {
        ctx.beginPath();
        ctx.moveTo(-r * 0.43, -r * 0.47);
        ctx.lineTo(-r * 0.16, -r * 0.51);
        ctx.moveTo(r * 0.16, -r * 0.51);
        ctx.lineTo(r * 0.43, -r * 0.47);
        ctx.stroke();
    }
    ctx.fillStyle = "#ff92b766";
    for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * r * 0.42, r * 0.2, r * 0.1, r * 0.05, 0, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}
