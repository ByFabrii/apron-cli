// Aviso de versión nueva: pregunta a npm cuál es la última versión publicada, como mucho una vez al día, y lo
// recuerda en la carpeta de configuración. No manda nada tuyo (es una petición pública sin datos del proyecto),
// no se hace en CI ni sin terminal, y se apaga con APRON_NO_UPDATE_CHECK=1.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { stderr } from "node:process";
import { configPath, env } from "./config";
import { c } from "./ui";
import { VERSION } from "./version";

export const PACKAGE = "@byfabrii/apron";
export const INSTALL = `npm install -g ${PACKAGE}`;
const REGISTRY = `https://registry.npmjs.org/${PACKAGE}/latest`;
const DAY = 24 * 60 * 60 * 1000;

interface Cache {
  checkedAt: number;
  latest?: string;
}

/** -1, 0 o 1. Solo mira x.y.z; "1.0.0-beta" cuenta como 1.0.0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => (v.match(/^(\d+)\.(\d+)\.(\d+)/)?.slice(1) ?? ["0", "0", "0"]).map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i]! !== y[i]!) return x[i]! < y[i]! ? -1 : 1;
  return 0;
}

export function cachePath(): string {
  return join(dirname(configPath()), "update-check.json");
}

function readCache(): Cache | undefined {
  try {
    const parsed = JSON.parse(readFileSync(cachePath(), "utf8")) as Cache;
    return typeof parsed.checkedAt === "number" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function writeCache(cache: Cache) {
  try {
    mkdirSync(dirname(cachePath()), { recursive: true });
    writeFileSync(cachePath(), JSON.stringify(cache) + "\n", "utf8");
  } catch {
    // Sin permiso para escribir: se vuelve a preguntar la próxima vez, no pasa nada.
  }
}

export function enabled(): boolean {
  return Boolean(stderr.isTTY) && !process.env.CI && !env("NO_UPDATE_CHECK");
}

/**
 * Última versión publicada si es más nueva que esta, o undefined. Usa lo guardado si tiene menos de un día; si no,
 * pregunta a npm con un tope de 1.5 s (sin red, simplemente no avisa).
 */
export async function newerVersion(now = Date.now(), fetcher: typeof fetch = fetch): Promise<string | undefined> {
  let cache = readCache();
  if (!cache || now - cache.checkedAt > DAY || now < cache.checkedAt) {
    let latest: string | undefined;
    try {
      const response = await fetcher(REGISTRY, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(1500) });
      if (response.ok) {
        const version = ((await response.json()) as { version?: unknown }).version;
        if (typeof version === "string" && /^\d+\.\d+\.\d+/.test(version)) latest = version;
      }
    } catch {
      // Sin internet o npm lento.
    }
    cache = { checkedAt: now, latest: latest ?? cache?.latest };
    writeCache(cache);
  }
  return cache.latest && compareVersions(cache.latest, VERSION) > 0 ? cache.latest : undefined;
}

export function printNotice(latest: string) {
  stderr.write(`\n${c.yellow("↑")} Hay una versión nueva de apron: ${c.dim(VERSION)} → ${c.green(latest)}\n`);
  stderr.write(`  ${c.dim(`Actualiza con: ${INSTALL}`)}\n`);
}
