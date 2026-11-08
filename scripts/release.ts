// Publica una versión del CLI: compila los ejecutables y los sube al proyecto "hangar-cli" del panel
// (un perfil por plataforma). /install.ps1 y /install.sh descargan siempre el más nuevo de ahí.
//
//   cd cli
//   bun run scripts/release.ts
//
// Llave: cli/.hangar.env (HANGAR_URL y HANGAR_TOKEN de un proyecto llamado hangar-cli) o esas variables de entorno.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Api } from "../src/api";
import { VERSION } from "../src/version";
import { TARGETS, buildBinary } from "./build-binaries";

function env(): { url: string; token: string } {
  let url = process.env.HANGAR_URL;
  let token = process.env.HANGAR_TOKEN;
  const file = join(import.meta.dir, "..", ".hangar.env");
  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = /^\s*(HANGAR_URL|HANGAR_TOKEN)\s*=\s*"?([^"#]*?)"?\s*$/.exec(line);
      if (m?.[1] === "HANGAR_URL") url ??= m[2];
      if (m?.[1] === "HANGAR_TOKEN") token ??= m[2];
    }
  }
  if (!url || !token) throw new Error("Falta HANGAR_URL / HANGAR_TOKEN (en cli/.hangar.env) del proyecto hangar-cli.");
  return { url: url.replace(/\/+$/, ""), token };
}

const { url, token } = env();
const api = new Api(url, token);
const me = await api.whoami();
if (me.slug !== "hangar-cli") console.warn(`Ojo: la llave es del proyecto "${me.slug}", no de "hangar-cli".`);

const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim() || undefined;
for (const platform of TARGETS) {
  const file = buildBinary(platform);
  const build = await api.upload(file, { profile: platform, version: VERSION, commit, notes: `Hangar CLI ${VERSION}` });
  console.log(`✔ ${platform} → ${build.url}`);
}
console.log(`\nListo. Se instala con:\n  irm ${url}/install.ps1 | iex\n  curl -fsSL ${url}/install.sh | sh`);
