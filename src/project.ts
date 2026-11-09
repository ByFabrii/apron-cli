// hangar.json: la configuración del proyecto. Va en el repo (no tiene secretos).
//
// {
//   "server": "https://hangar.ejemplo.com",
//   "project": "preno",
//   "profiles": {
//     "preview": { "build": "npm run build:android", "artifact": "dist/*-preview.apk" }
//   }
// }
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findCredential, loadConfig, normalizeServer } from "./config";
import { fail } from "./ui";

export const PROJECT_FILE = "hangar.json";

export interface ProfileConfig {
  /** Comando que compila ese perfil. Se corre con la shell del sistema, desde la raíz del proyecto. */
  build?: string;
  /** Dónde queda el archivo (admite * y **). Si coinciden varios, se usa el más nuevo. */
  artifact?: string;
  /**
   * Expo: compila como ese perfil de eas.json (sus variables "env", sin .env y con el
   * caché de Metro limpio). Ver buildenv.ts.
   */
  eas?: string;
  /** Variables de entorno extra para el build. Ganan sobre las de "eas". */
  env?: Record<string, string>;
}

export interface ProjectConfig {
  $schema?: string;
  server?: string;
  project: string;
  profiles: Record<string, ProfileConfig>;
}

export interface LoadedProject {
  root: string;
  file: string;
  config: ProjectConfig;
}

/** Busca hangar.json desde la carpeta actual hacia arriba (como git). */
export function findProject(from = process.cwd()): LoadedProject | undefined {
  let dir = resolve(from);
  while (true) {
    const file = join(dir, PROJECT_FILE);
    if (existsSync(file)) {
      let config: ProjectConfig;
      try {
        config = JSON.parse(readFileSync(file, "utf8")) as ProjectConfig;
      } catch (e) {
        fail(`${file} no es JSON válido: ${(e as Error).message}`);
      }
      if (!config.project || typeof config.project !== "string") fail(`${file} no dice el "project" (identificador en Hangar).`);
      config.profiles ??= {};
      return { root: dir, file, config };
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function requireProject(): LoadedProject {
  const project = findProject();
  if (!project) fail("No encontré hangar.json en esta carpeta ni más arriba.", "Corre `hangar init` en la raíz de tu proyecto.");
  return project;
}

export function writeProject(root: string, config: ProjectConfig): string {
  const file = join(root, PROJECT_FILE);
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n", "utf8");
  return file;
}

export interface Auth {
  server: string;
  token: string;
  project?: string;
  source: string;
}

/** Lee siae-app/.hangar.env (formato del script de Preno), para no romper lo que ya funciona. */
function readDotHangar(root: string): { url?: string; token?: string } {
  const file = join(root, ".hangar.env");
  if (!existsSync(file)) return {};
  const out: { url?: string; token?: string } = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(HANGAR_URL|HANGAR_TOKEN)\s*=\s*"?([^"#]*?)"?\s*$/.exec(line);
    if (m?.[1] === "HANGAR_URL") out.url = m[2];
    if (m?.[1] === "HANGAR_TOKEN") out.token = m[2];
  }
  return out;
}

/** El servidor: variable HANGAR_URL > hangar.json > .hangar.env > el que guardó el instalador. */
export function resolveServer(project?: LoadedProject): string | undefined {
  const fromEnv = process.env.HANGAR_URL;
  const fromProject = project?.config.server;
  const fromDot = project ? readDotHangar(project.root).url : undefined;
  const value = fromEnv || fromProject || fromDot || loadConfig().server;
  return value ? normalizeServer(value) : undefined;
}

/**
 * La llave para subir. En orden:
 *   1. HANGAR_TOKEN (CI/CD).
 *   2. La que guardó `hangar login` para este servidor + proyecto.
 *   3. .hangar.env en la raíz del proyecto (compatibilidad con el script de Preno).
 */
export function resolveAuth(project?: LoadedProject): Auth {
  const server = resolveServer(project);
  if (!server) fail("No sé a qué panel conectarme.", "Agrega \"server\" en hangar.json o corre `hangar config server <url>`.");
  if (process.env.HANGAR_TOKEN) {
    return { server, token: process.env.HANGAR_TOKEN, project: project?.config.project, source: "variable HANGAR_TOKEN" };
  }
  if (project) {
    const saved = findCredential(server, project.config.project);
    if (saved) return { server, token: saved.token, project: project.config.project, source: "hangar login" };
    const dot = readDotHangar(project.root);
    if (dot.token) return { server, token: dot.token, project: project.config.project, source: ".hangar.env" };
  }
  fail(
    project ? `No tengo llave para el proyecto "${project.config.project}" en ${server}.` : "No hay una llave configurada.",
    "Corre `hangar login` (abre el navegador para autorizar esta terminal).",
  );
}
