// apron.json: la configuración del proyecto. Va en el repo (no tiene secretos).
// También se lee hangar.json, el nombre anterior, para no romper proyectos que ya lo tienen.
//
// {
//   "server": "https://apron.ejemplo.com",
//   "project": "mi-app",
//   "profiles": {
//     "preview": { "build": "npm run build:android", "artifact": "dist/*-preview.apk" }
//   }
// }
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { env, findCredential, loadConfig, normalizeServer } from "./config";
import { fail } from "./ui";

export const PROJECT_FILE = "apron.json";
/** Nombre anterior del archivo: se sigue leyendo si no existe apron.json. */
export const LEGACY_PROJECT_FILE = "hangar.json";

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

/** Busca apron.json (o hangar.json) desde la carpeta actual hacia arriba (como git). */
export function findProject(from = process.cwd()): LoadedProject | undefined {
  let dir = resolve(from);
  while (true) {
    const file = [PROJECT_FILE, LEGACY_PROJECT_FILE].map((name) => join(dir, name)).find((f) => existsSync(f));
    if (file) {
      let config: ProjectConfig;
      try {
        config = JSON.parse(readFileSync(file, "utf8")) as ProjectConfig;
      } catch (e) {
        fail(`${file} no es JSON válido: ${(e as Error).message}`);
      }
      if (!config.project || typeof config.project !== "string") fail(`${file} no dice el "project" (identificador en Apron).`);
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
  if (!project) fail(`No encontré ${PROJECT_FILE} en esta carpeta ni más arriba.`, "Corre `apron init` en la raíz de tu proyecto.");
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

export interface DotEnv {
  url?: string;
  token?: string;
  file?: string;
}

/**
 * La llave del proyecto en .apron.env (o .hangar.env, el nombre anterior): APRON_URL y APRON_TOKEN (también se
 * aceptan HANGAR_URL y HANGAR_TOKEN). Git debe ignorar ese archivo.
 */
export function readDotEnv(root: string): DotEnv {
  const file = [".apron.env", ".hangar.env"].map((name) => join(root, name)).find((f) => existsSync(f));
  if (!file) return {};
  const out: DotEnv = { file: basename(file) };
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*(?:APRON|HANGAR)_(URL|TOKEN)\s*=\s*"?([^"#]*?)"?\s*$/.exec(line);
    if (m?.[1] === "URL") out.url = m[2];
    if (m?.[1] === "TOKEN") out.token = m[2];
  }
  return out;
}

/** El servidor: variable APRON_URL > apron.json > .apron.env > el que guardó `apron login`. */
export function resolveServer(project?: LoadedProject): string | undefined {
  const fromEnv = env("URL");
  const fromProject = project?.config.server;
  const fromDot = project ? readDotEnv(project.root).url : undefined;
  const value = fromEnv || fromProject || fromDot || loadConfig().server;
  return value ? normalizeServer(value) : undefined;
}

/**
 * La llave para subir. En orden:
 *   1. APRON_TOKEN (CI/CD; también HANGAR_TOKEN, el nombre anterior).
 *   2. La que guardó `apron login` para este servidor + proyecto.
 *   3. .apron.env (o .hangar.env) en la raíz del proyecto.
 */
export function resolveAuth(project?: LoadedProject): Auth {
  const server = resolveServer(project);
  if (!server) fail("No sé a qué panel conectarme.", `Agrega "server" en ${PROJECT_FILE} o corre \`apron config server <url>\`.`);
  const fromEnv = env("TOKEN");
  if (fromEnv) {
    const source = process.env.APRON_TOKEN ? "variable APRON_TOKEN" : "variable HANGAR_TOKEN";
    return { server, token: fromEnv, project: project?.config.project, source };
  }
  if (project) {
    const saved = findCredential(server, project.config.project);
    if (saved) return { server, token: saved.token, project: project.config.project, source: "apron login" };
    const dot = readDotEnv(project.root);
    if (dot.token) return { server, token: dot.token, project: project.config.project, source: dot.file ?? ".apron.env" };
  }
  fail(
    project ? `No tengo llave para el proyecto "${project.config.project}" en ${server}.` : "No hay una llave configurada.",
    "Corre `apron login` (abre el navegador para autorizar esta terminal).",
  );
}
