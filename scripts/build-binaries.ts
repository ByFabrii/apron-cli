// Compila el CLI a un ejecutable por plataforma (no necesitan Node ni Bun instalados).
//   bun run scripts/build-binaries.ts            → todas
//   bun run scripts/build-binaries.ts windows-x64 → solo una
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const TARGETS = ["windows-x64", "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"] as const;

export function outputFor(platform: string): string {
  return join(import.meta.dir, "..", "dist", "bin", `hangar-${platform}${platform.startsWith("windows") ? ".exe" : ""}`);
}

export function buildBinary(platform: string): string {
  const outfile = outputFor(platform);
  mkdirSync(join(import.meta.dir, "..", "dist", "bin"), { recursive: true });
  // Sin cargar el .env ni el bunfig.toml de la carpeta donde se corre: el ejecutable se
  // usa dentro de los proyectos, y sus variables se colaban a los builds (un .env con
  // modo demo hacía salir así hasta el build de producción).
  const result = Bun.spawnSync(
    ["bun", "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig",
      "--minify", "--sourcemap=none", `--target=bun-${platform}`,
      join(import.meta.dir, "..", "src", "index.ts"), "--outfile", outfile],
    { stdout: "inherit", stderr: "inherit" },
  );
  if (result.exitCode !== 0) throw new Error(`Falló la compilación para ${platform}`);
  return outfile;
}

if (import.meta.main) {
  const wanted = process.argv.slice(2);
  for (const platform of wanted.length ? wanted : TARGETS) {
    if (!TARGETS.includes(platform as (typeof TARGETS)[number])) throw new Error(`Plataforma desconocida: ${platform}`);
    console.log(`→ ${platform}: ${buildBinary(platform)}`);
  }
}
