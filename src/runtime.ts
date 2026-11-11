// Runtime de expo-updates: el número que decide a qué APK le llega una actualización OTA.
//
// Con "runtimeVersion": { "policy": "fingerprint" } el runtime es una huella de la parte nativa de la app
// (dependencias con código nativo, plugins, permisos, íconos…). Si solo cambió JavaScript, la huella es la misma
// aunque la versión de la app suba; si cambió algo nativo, la huella cambia y el APK instalado ya no es compatible.
// La calcula el propio expo-updates (`npx expo-updates runtimeversion:resolve`), igual que al compilar el APK.
import { spawnSync } from "node:child_process";

export type Sources = [string, string][];

export interface Resolved {
  runtimeVersion: string;
  /** Fuentes de la huella ([ruta o id, hash]); solo con la política fingerprint. */
  sources?: Sources;
}

interface RawSource {
  type?: string;
  filePath?: string;
  id?: string;
  hash?: string | null;
}

/** Fuentes compactas: lo justo para comparar dos huellas (~10 KB en una app típica). */
export function compact(raw: RawSource[] | null | undefined): Sources | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Sources = [];
  for (const s of raw) {
    const key = s.type === "contents" ? s.id : s.filePath;
    if (key && s.hash) out.push([key, s.hash]);
  }
  return out;
}

/** Lee la salida JSON de runtimeversion:resolve (puede traer avisos antes). */
export function parseResolve(stdout: string): Resolved | undefined {
  const start = stdout.indexOf('{"runtimeVersion"');
  if (start < 0) return undefined;
  try {
    const parsed = JSON.parse(stdout.slice(start).trim()) as { runtimeVersion?: unknown; fingerprintSources?: RawSource[] | null };
    if (typeof parsed.runtimeVersion !== "string" || !parsed.runtimeVersion) return undefined;
    return { runtimeVersion: parsed.runtimeVersion, sources: compact(parsed.fingerprintSources) };
  } catch {
    return undefined;
  }
}

/** Runtime de una plataforma, con las variables del perfil (cambian la configuración de Expo y, con ella, la huella). */
export function resolveRuntime(root: string, platform: string, env: NodeJS.ProcessEnv): Resolved | { error: string } {
  const result = spawnSync(`npx expo-updates runtimeversion:resolve --platform ${platform}`, {
    cwd: root, env, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
  });
  const resolved = result.status === 0 ? parseResolve(result.stdout ?? "") : undefined;
  if (resolved) return resolved;
  const detail = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim().split("\n").filter(Boolean).slice(-2).join(" ");
  return { error: detail || `código ${result.status}` };
}

/** Nombre legible de una fuente de la huella. */
function describe(key: string): string {
  const pkg = key.match(/^node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (pkg) return `dependencia nativa ${pkg[1]}`;
  if (key === "expoConfig" || key.startsWith("expoConfig")) return "configuración de Expo (app.json / app.config.js: plugins, permisos, íconos…)";
  if (key.startsWith("packageJson:scripts")) return "scripts de package.json";
  if (/AutolinkingConfig/.test(key)) return "módulos nativos enlazados (se agregó, quitó o actualizó una dependencia nativa)";
  if (key.startsWith("package:react-native")) return "versión de React Native";
  if (key === "android" || key.startsWith("android/")) return "carpeta android/";
  if (key === "ios" || key.startsWith("ios/")) return "carpeta ios/";
  return key;
}

/** Qué cambió en lo nativo entre la huella de un APK y la del código actual (máximo `limit` renglones). */
export function explainDiff(before: Sources, after: Sources, limit = 8): string[] {
  const a = new Map(before);
  const b = new Map(after);
  const changes = new Map<string, string>();
  const note = (key: string, what: string) => {
    const label = describe(key);
    if (!changes.has(label)) changes.set(label, what);
    else if (changes.get(label) !== what) changes.set(label, "cambió");
  };
  for (const [key, hash] of b) {
    if (!a.has(key)) note(key, "nueva");
    else if (a.get(key) !== hash) note(key, "cambió");
  }
  for (const key of a.keys()) if (!b.has(key)) note(key, "ya no está");
  const lines = [...changes.entries()].map(([label, what]) => `${label}: ${what}`);
  return lines.length > limit ? [...lines.slice(0, limit), `…y ${lines.length - limit} más`] : lines;
}
