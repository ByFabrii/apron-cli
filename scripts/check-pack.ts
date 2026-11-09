// Revisa el paquete de npm ANTES de publicarlo (corre solo en prepublishOnly). Falla si:
//  - el paquete trae algo más que dist/apron.js, README.md, LICENSE y package.json (p. ej. .apron.env o config.json);
//  - package.json tiene scripts de instalación (preinstall/install/postinstall/prepare) o dependencias:
//    quien instala el CLI no debe ejecutar ni descargar nada más;
//  - el código publicado contiene algo que parezca una llave, un webhook o una ruta de esta computadora.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const fail = (msg: string): never => {
  console.error(`✖ check-pack: ${msg}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const hook of ["preinstall", "install", "postinstall", "prepare"]) {
  if (pkg.scripts?.[hook]) fail(`package.json tiene el script "${hook}": quien instale el CLI lo ejecutaría.`);
}
for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "bundleDependencies", "bundledDependencies"]) {
  if (pkg[field] && Object.keys(pkg[field]).length > 0) {
    fail(`package.json tiene "${field}": el CLI se publica como un solo archivo, sin dependencias.`);
  }
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const pack = spawnSync(npm, ["pack", "--dry-run", "--json", "--ignore-scripts"], { encoding: "utf8", shell: process.platform === "win32" });
if (pack.status !== 0) fail(`npm pack falló:\n${pack.stderr}`);
const files: string[] = JSON.parse(pack.stdout)[0].files.map((f: { path: string }) => f.path).sort();
const expected = ["LICENSE", "README.md", "dist/apron.js", "package.json"];
if (JSON.stringify(files) !== JSON.stringify(expected)) {
  fail(`el paquete trae ${JSON.stringify(files)}; solo se permite ${JSON.stringify(expected)}.`);
}

const code = readFileSync("dist/apron.js", "utf8");
const secrets: [RegExp, string][] = [
  [/(hgr|apr)_[A-Za-z0-9_-]{16,}/, "una llave del panel (apr_… o hgr_…)"],
  [/(APRON|HANGAR)_TOKEN\s*=\s*\S{8,}/, "un APRON_TOKEN con valor"],
  [/discord(app)?\.com\/api\/webhooks\/\d+\/[\w-]{20,}/, "un webhook de Discord"],
  [/\d{6,12}:AA[\w-]{30,}/, "un token de bot de Telegram"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "una llave privada"],
  [/npm_[A-Za-z0-9]{30,}/, "un token de npm"],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, "un token de GitHub"],
  [/[A-Za-z]:\\\\(Users|DEVELOPMENT)\\\\/i, "una ruta de esta computadora"],
  [/\/(Users|home)\/[a-z0-9._-]+\/(?!\.config)/i, "una ruta de una carpeta personal"],
];
for (const [re, what] of secrets) {
  const m = re.exec(code);
  if (m) fail(`dist/apron.js contiene ${what}: "${m[0].slice(0, 24)}…"`);
}

console.log(`✔ check-pack: ${files.join(", ")} · sin scripts de instalación, sin dependencias, sin secretos.`);
