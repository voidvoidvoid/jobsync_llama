// Bundles the Firefox extension into extension/dist and packages it as
// public/extension/jobsync-autofill.xpi, which JobSync serves for download.
// Usage: node extension/build.mjs
import { build } from "rolldown";
import { mkdirSync, rmSync, copyFileSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync, crc32 } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "dist");
const out = join(here, "..", "public", "extension", "jobsync-autofill.xpi");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const entry of ["background", "content", "options"]) {
  const input = entry === "content" ? join(here, "src", "content", "index.ts") : join(here, "src", `${entry}.ts`);
  await build({
    input,
    // Scripts run as classic scripts: one self-contained file each
    output: { file: join(dist, `${entry}.js`), format: "iife", minify: false },
    platform: "browser",
    logLevel: "warn",
  });
}
for (const file of ["manifest.json", "options.html", "icon.svg"]) {
  copyFileSync(join(here, file), join(dist, file));
}

// Minimal zip writer (an .xpi is a zip with the manifest at its root)
function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuf = Buffer.from(name);
    const deflated = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); // time 00:00 and date 1980-01-01 keep builds reproducible
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, deflated);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(deflated.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + deflated.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dist)
  .sort()
  .map((p) => ({ name: relative(dist, p).split("\\").join("/"), data: readFileSync(p) }));
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, zip(files));
console.log(`Built ${relative(process.cwd(), out)} (${files.length} files)`);
