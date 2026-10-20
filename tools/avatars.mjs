// The students (v0.21): cuts the character sheet (media/students.webp, 4×4
// students drawn for the game with an image model on ElevenLabs) into the
// sixteen round-avatar portraits, client/public/avatars/<slug>.webp (256 px).
// Each crop is a square around the student's face, so it reads at 20 px and
// still shows their gag at 100 px. Order and slugs: client/src/avatars.ts.
// Needs ffmpeg: FFMPEG=<path>, or `npm i --no-save ffmpeg-static`, or ffmpeg on PATH.
// Usage: npm run avatars
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";

const SHEET = "media/students.webp"; // 2048×2048
const OUT = "client/public/avatars";
const SIZE = 256;
const QUALITY = 80;

let ffmpeg = process.env.FFMPEG ?? "ffmpeg";
if (!process.env.FFMPEG) {
  try {
    ffmpeg = createRequire(import.meta.url)("ffmpeg-static");
  } catch {
    /* ffmpeg on PATH */
  }
}

// [slug, centre x, centre y, side] in sheet pixels. The sheet's tiles are not
// all the same size (columns 8–487, 496–961, 970–1432, 1440–2039; rows 8–559,
// 568–1069, 1078–1540, 1549–2039), so every crop stays inside its own tile.
const CROPS = [
  ["backpack", 247, 300, 390],
  ["books", 738, 265, 445],
  ["pencil", 1203, 307, 445],
  ["testtube", 1738, 297, 509],
  ["microscope", 238, 850, 410],
  ["setsquare", 731, 827, 460],
  ["palette", 1201, 827, 456],
  ["headphones", 1707, 827, 466],
  ["soccer", 244, 1304, 445],
  ["apple", 721, 1300, 440],
  ["abacus", 1203, 1314, 445],
  ["map", 1696, 1314, 450],
  ["crayon", 239, 1802, 456],
  ["basketball", 740, 1781, 440],
  ["trumpet", 1200, 1781, 456],
  ["laptop", 1700, 1790, 420],
];

mkdirSync(OUT, { recursive: true });
for (const [slug, cx, cy, side] of CROPS) {
  const out = `${OUT}/${slug}.webp`;
  execFileSync(ffmpeg, [
    "-v", "error", "-y", "-i", SHEET,
    "-vf", `crop=${side}:${side}:${Math.round(cx - side / 2)}:${Math.round(cy - side / 2)},scale=${SIZE}:${SIZE}:flags=lanczos`,
    "-c:v", "libwebp", "-quality", String(QUALITY), "-compression_level", "6", "-preset", "drawing",
    out,
  ]);
  console.log(`${out} ${(statSync(out).size / 1024).toFixed(1)} KB`);
}
