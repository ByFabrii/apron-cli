// Configuración global del usuario (fuera de los proyectos): servidor por omisión y llaves por proyecto.
//   Windows: %APPDATA%\apron\config.json      macOS/Linux: ~/.config/apron/config.json
// Las llaves NUNCA van en el repo: se guardan aquí, una por servidor + proyecto, con permisos solo para tu usuario.
// Si solo existe la configuración del nombre anterior (…\hangar\config.json) se lee de ahí, y la siguiente vez que
// se guarde algo queda en la carpeta nueva.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface Credential {
  token: string;
  projectName?: string;
  savedAt: string;
}

export interface GlobalConfig {
  server?: string;
  credentials: Record<string, Record<string, Credential>>; // servidor → proyecto → llave
}

/** Variable de entorno APRON_<name>, o la del nombre anterior HANGAR_<name>. */
export function env(name: string): string | undefined {
  return process.env[`APRON_${name}`] || process.env[`HANGAR_${name}`] || undefined;
}

function baseDir(): string {
  return process.platform === "win32"
    ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
    : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
}

export function configPath(): string {
  return env("CONFIG") ?? join(baseDir(), "apron", "config.json");
}

/** Configuración del nombre anterior (Hangar), solo para leerla. */
function legacyConfigPath(): string | undefined {
  if (env("CONFIG")) return undefined;
  const legacy = join(baseDir(), "hangar", "config.json");
  return existsSync(legacy) ? legacy : undefined;
}

export function loadConfig(): GlobalConfig {
  const path = existsSync(configPath()) ? configPath() : legacyConfigPath();
  if (!path) return { credentials: {} };
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<GlobalConfig>;
    return { server: parsed.server, credentials: parsed.credentials ?? {} };
  } catch {
    return { credentials: {} };
  }
}

export function saveConfig(config: GlobalConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // En Windows los permisos los da la carpeta del usuario (%APPDATA%).
  }
}

export function normalizeServer(url: string): string {
  let value = url.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  return value.replace(/\/+$/, "");
}

export function saveCredential(server: string, project: string, credential: Credential): void {
  const config = loadConfig();
  const key = normalizeServer(server);
  config.credentials[key] = { ...(config.credentials[key] ?? {}), [project]: credential };
  config.server ??= key;
  saveConfig(config);
}

export function removeCredential(server: string, project: string): boolean {
  const config = loadConfig();
  const key = normalizeServer(server);
  const forServer = config.credentials[key];
  if (!forServer || !forServer[project]) return false;
  delete forServer[project];
  saveConfig(config);
  return true;
}

export function findCredential(server: string, project: string): Credential | undefined {
  return loadConfig().credentials[normalizeServer(server)]?.[project];
}
