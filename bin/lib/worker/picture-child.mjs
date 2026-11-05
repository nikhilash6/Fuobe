// Run by picture.mjs in a process of its own: node picture-child.mjs <src> <dst> <max pixels>. Reads one picture as it
// came (sharp, at most <max pixels>, any error in the file refused), turns it upright by its EXIF orientation and writes
// it as a fresh PNG with no metadata. Exit 0 when it wrote one.
import fs from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
// sharp comes from the worker's checkout (pnpm install): the CLI package itself imports only Node's own modules.
const sharp = (await import(pathToFileURL(createRequire(import.meta.url).resolve("sharp")).href)).default;

const [src, dst, max] = process.argv.slice(2);
try {
  sharp.concurrency(1);
  const png = await sharp(fs.readFileSync(src), { failOn: "error", limitInputPixels: Number(max) || 64 * 2 ** 20 }).rotate().png().toBuffer();
  fs.writeFileSync(dst, png, { mode: 0o600 });
  process.exit(0);
} catch {
  process.exit(1);
}
