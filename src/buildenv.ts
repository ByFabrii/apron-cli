// Variables de entorno con las que corre `apron build`.
//
// Con "eas": "<perfil>" en apron.json, el build local se comporta como uno de EAS:
// - toma las variables "env" de ese perfil de eas.json, siguiendo "extends" como EAS;
// - no carga .env (EAS no lo sube: está en .gitignore);
// - no pregunta por cambios sin commit en git (expo prebuild se quedaría esperando).
// "env" en apron.json se suma al final y gana sobre todo lo anterior.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProfileConfig } from "./project";

const EAS_LIKE: Record<string, string> = {
  EXPO_NO_DOTENV: "1",
  EXPO_NO_GIT_STATUS: "1",
};

interface EasProfile {
  extends?: string;
  env?: Record<string, string>;
}

/** Variables "env" de un perfil de eas.json, con las de los perfiles que extiende. undefined si no existe. */
export function easProfileEnv(root: string, name: string): Record<string, string> | undefined {
  const file = join(root, "eas.json");
  if (!existsSync(file)) return undefined;
  let profiles: Record<string, EasProfile>;
  try {
    profiles = (JSON.parse(readFileSync(file, "utf8")) as { build?: Record<string, EasProfile> }).build ?? {};
  } catch {
    return undefined;
  }
  if (!profiles[name]) return undefined;

  // Del perfil hacia sus "extends"; el más lejano va primero para que el propio gane
  const chain: EasProfile[] = [];
  const seen = new Set<string>();
  let current: string | undefined = name;
  while (current && !seen.has(current)) {
    const profile: EasProfile | undefined = profiles[current];
    if (!profile) break;
    seen.add(current);
    chain.unshift(profile);
    current = profile.extends;
  }
  return Object.assign({}, ...chain.map((p) => p.env ?? {}));
}

export interface BuildEnv {
  env: NodeJS.ProcessEnv;
  /** Nombres de las variables que agregó Apron (sin valores: pueden ser secretos) */
  added: string[];
}

/** Entorno del build de un perfil. Falla con un mensaje si "eas" apunta a un perfil que no existe. */
export function buildEnv(root: string, profile: ProfileConfig, fail: (msg: string, hint?: string) => never): BuildEnv {
  const extra: Record<string, string> = {};
  if (profile.eas) {
    const fromEas = easProfileEnv(root, profile.eas);
    if (!fromEas) fail(`El perfil "${profile.eas}" no está en eas.json.`, `Revisa "eas" del perfil en apron.json.`);
    Object.assign(extra, EAS_LIKE, fromEas);
  }
  Object.assign(extra, profile.env ?? {});
  return { env: { ...process.env, ...extra }, added: Object.keys(extra) };
}

/**
 * Borra el caché de Metro. En un build de producción Expo escribe el valor de las
 * variables EXPO_PUBLIC_ dentro del código, y el caché no distingue ese valor: sin
 * esto, un build podría salir con las variables del anterior.
 */
export function clearMetroCache(): string {
  const dir = join(tmpdir(), "metro-cache");
  rmSync(dir, { recursive: true, force: true });
  return dir;
}
