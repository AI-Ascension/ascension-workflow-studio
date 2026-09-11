import { readdir, readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../dist/", import.meta.url);
const assets = [];
async function walk(relative = "") {
  for (const name of (await readdir(new URL(relative, root))).sort()) {
    const path = relative + name, file = new URL(path, root);
    if ((await stat(file)).isDirectory()) await walk(path + "/");
    else {
      const bytes = await readFile(file);
      assets.push({ path, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
}
await walk();
const pin = JSON.parse(await readFile(new URL("../contracts/recorded-run-candidate/studio-pin.json", import.meta.url), "utf8"));
const output = new URL("../docs/evidence/recorded-run-local/", import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL("build-assets.json", output), JSON.stringify({ scope: "local tested production build for coordinator deployment; not LAN deployment evidence", contract_version: pin.format_version, schema_sha256: pin.checksums["schema.json"], inventory_sha256: pin.checksums.SHA256SUMS, assets }, null, 2) + "\n");
console.log(JSON.stringify({ files: assets.length, assets }, null, 2));
