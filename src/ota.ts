// apron update: publica una actualización OTA (expo-updates) en el panel.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Api, type OtaCompat } from "./api";
import { buildEnv, clearMetroCache, easProfileEnv } from "./buildenv";
import * as git from "./git";
import { requireProject, resolveAuth, type LoadedProject, type ProfileConfig } from "./project";
import { explainDiff, resolveRuntime, type Resolved, type Sources } from "./runtime";
import { c, confirm, fail, formatSize, info, interactive, ok, relative as ago, step, table, warn } from "./ui";

type Flags = Record<string, string | boolean>;
const str = (flags: Flags, name: string) => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);

export interface ExpoConfig {
  name?: string;
  version?: string;
  runtimeVersion?: string | { policy?: string };
  updates?: { url?: string; enabled?: boolean; requestHeaders?: Record<string, string> };
  android?: { versionCode?: number };
  [key: string]: unknown;
}

function run(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, env, shell: true, stdio: "inherit" });
    child.on("error", () => resolve(127));
    child.on("close", (code) => resolve(code ?? 1));
  });
}

/** `npx expo config --json --type public`: la configuración ya resuelta (app.json + app.config.js). */
export function expoConfig(root: string, env: NodeJS.ProcessEnv): ExpoConfig {
  const result = spawnSync("npx expo config --json --type public", { cwd: root, env, shell: true, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const out = result.stdout ?? "";
  const start = out.indexOf("{");
  if (result.status !== 0 || start < 0) fail("No pude leer la configuración de Expo (npx expo config).", (result.stderr ?? "").trim().split("\n").slice(-3).join(" "));
  try {
    return JSON.parse(out.slice(start)) as ExpoConfig;
  } catch {
    fail("La salida de `npx expo config --json` no es JSON.");
  }
}

type Policy = "fingerprint" | "appVersion" | string | undefined;

function policy(config: ExpoConfig): Policy {
  const rv = config.runtimeVersion;
  return rv && typeof rv === "object" ? rv.policy : undefined;
}

/** Runtime de una plataforma, como lo calcula expo-updates al compilar el APK. */
export function runtimeFor(config: ExpoConfig, flags: Flags, root: string, platform: string, env: NodeJS.ProcessEnv): Resolved {
  const forced = str(flags, "runtime-version");
  if (forced) return { runtimeVersion: forced };
  const rv = config.runtimeVersion;
  if (typeof rv === "string" && rv) return { runtimeVersion: rv };
  if (!rv) fail("app.json no tiene runtimeVersion.", "Agrega \"runtimeVersion\": { \"policy\": \"fingerprint\" } dentro de \"expo\" y compila un APK nuevo.");
  const resolved = resolveRuntime(root, platform, env);
  if ("runtimeVersion" in resolved) return resolved;
  if (policy(config) === "appVersion" && config.version) return { runtimeVersion: config.version };
  fail(`No pude calcular el runtime (${policy(config)}) para ${platform}: ${resolved.error}`,
    "¿Está instalado expo-updates? npx expo install expo-updates. O pásalo a mano con --runtime-version.");
}

const short = (rv: string) => (rv.length > 12 ? rv.slice(0, 10) : rv);

/**
 * Pregunta al panel a cuántos dispositivos les llega y avisa si el código ya no es compatible con el APK que tienen
 * (cambió algo nativo). Devuelve false si hay que detenerse.
 */
async function checkCompat(api: Api, channel: string, runtimes: Map<string, Resolved>, config: ExpoConfig, flags: Flags): Promise<boolean> {
  let problems = 0;
  for (const [platform, resolved] of runtimes) {
    const rv = resolved.runtimeVersion;
    const compat = await api.otaCompat(channel, platform, rv);
    if (!compat) {
      info(`${platform}: el panel no informa dispositivos (actualízalo a 0.9 o más nuevo para el aviso de compatibilidad).`);
      continue;
    }
    const others = compat.devices - compat.compatible;
    const failing = compat.runtimes.filter((r) => r.runtimeVersion === rv).reduce((n, r) => n + r.failing, 0);
    if (compat.compatible > 0) {
      ok(`${platform}: le llegará a ${compat.compatible} de ${compat.devices} dispositivo(s) activos del canal ${channel}.`);
      if (others > 0) info(`${others} tienen un APK con otra parte nativa y no la recibirán hasta instalar uno nuevo.`);
      if (failing > 0) warn(`${failing} dispositivo(s) reportaron que una actualización anterior no arrancó y regresaron a la de antes.`);
      continue;
    }
    if (compat.devices === 0 && compat.matchingBuild) {
      info(`${platform}: aún no hay dispositivos reportando; el APK ${compat.matchingBuild.label} (${ago(compat.matchingBuild.createdAt)}) tiene este runtime.`);
      continue;
    }
    if (compat.devices === 0 && !compat.reference) {
      info(`${platform}: el panel aún no conoce dispositivos ni APKs con runtime en el canal ${channel}: no puedo comprobar a quién le llega.`);
      continue;
    }

    problems++;
    const ref = compat.reference;
    warn(compat.devices > 0
      ? `${platform}: NINGUNO de los ${compat.devices} dispositivo(s) del canal ${channel} tiene un APK compatible con este código.`
      : `${platform}: este código ya no es compatible con el último APK del canal ${channel}${ref ? ` (${ref.label}, ${ago(ref.createdAt)})` : ""}.`);
    const fingerprint = compat.referenceFingerprint ? (JSON.parse(compat.referenceFingerprint) as Sources) : undefined;
    if (fingerprint && resolved.sources) {
      const lines = explainDiff(fingerprint, resolved.sources);
      if (lines.length) {
        console.error(`  ${c.bold("Cambió en la parte nativa desde ese APK:")}`);
        for (const line of lines) console.error(`    ${c.yellow("•")} ${line}`);
      }
    } else if (policy(config) === "appVersion") {
      console.error(`  La versión de la app (${config.version}) no es la del APK instalado${ref ? ` (${ref.runtimeVersion})` : ""}: con la política appVersion cada versión necesita su APK.`);
    } else if (ref) {
      console.error(`  Runtime del APK: ${short(ref.runtimeVersion)} · runtime de este código: ${short(rv)}.`);
    }
  }
  if (problems === 0) return true;

  console.error(`\n  ${c.bold("Qué hacer:")} compila e instala un APK nuevo en esos dispositivos (${c.cyan(`apron build ${channel}`)}) y comparte el enlace.`);
  console.error(`  Si publicas así, solo la recibirán los APK nuevos con este runtime; los actuales se quedan como están (no se rompen).`);
  if (flags.force) {
    warn("--force: publicando de todos modos.");
    return true;
  }
  if (!interactive()) fail("Detenido: la actualización no le llegaría a los dispositivos actuales.", "Si es a propósito, repite con --force.");
  return confirm("¿Publicarla de todos modos?", false);
}

/**
 * Perfil con el que se exporta: --profile, o el que se llama como el canal. Busca primero en apron.json y luego en
 * eas.json. Así el JavaScript de la actualización lleva las mismas variables (EXPO_PUBLIC_…) que el APK que la recibe.
 */
export function updateProfile(project: LoadedProject, channel: string, explicit?: string): { name: string; profile: ProfileConfig } | undefined {
  const name = explicit ?? channel;
  const own = project.config.profiles[name];
  if (own) return { name, profile: own };
  if (easProfileEnv(project.root, name)) return { name, profile: { eas: name } };
  if (explicit) fail(`No existe el perfil "${explicit}" ni en apron.json ni en eas.json.`);
  return undefined;
}

export async function update(flags: Flags) {
  const project = requireProject();
  const root = project.root;
  if (!existsSync(join(root, "app.json")) && !existsSync(join(root, "app.config.js")) && !existsSync(join(root, "app.config.ts"))) {
    fail("Las actualizaciones OTA son para proyectos Expo (no encontré app.json).");
  }
  const auth = resolveAuth(project);
  const api = new Api(auth.server, auth.token);
  const me = await api.whoami();
  ok(`Panel: ${me.name} (${me.slug})`);

  const channel = (str(flags, "channel") ?? "production").toLowerCase();
  const platformFlag = (str(flags, "platform") ?? "all").toLowerCase();
  const platforms = platformFlag === "all" ? ["android", "ios"] : [platformFlag];
  if (!platforms.every((p) => p === "android" || p === "ios")) fail("--platform va con android, ios o all.");

  const selected = updateProfile(project, channel, str(flags, "profile"));
  let env: NodeJS.ProcessEnv = process.env;
  if (selected) {
    const built = buildEnv(root, selected.profile, fail);
    env = built.env;
    if (selected.profile.eas) {
      info(`Como el perfil ${c.bold(selected.profile.eas)} de eas.json, sin .env (igual que apron build)`);
      info(`Caché de Metro limpio: ${c.dim(clearMetroCache())}`);
    }
    if (built.added.length) info(`Variables del perfil ${selected.name}: ${c.dim(built.added.join(", "))}`);
  } else {
    info(`No hay un perfil "${channel}" en apron.json ni en eas.json: se exporta con tus variables y .env.`);
  }

  step("Leyendo la configuración de Expo…");
  const config = expoConfig(root, env);
  const runtimes = new Map<string, Resolved>();
  for (const platform of platforms) runtimes.set(platform, runtimeFor(config, flags, root, platform, env));
  const expected = `${auth.server}/ota/${me.slug}/manifest`;
  if (!config.updates?.url) {
    warn(`app.json no tiene updates.url: las apps no van a buscar actualizaciones. Debe ser ${expected}`);
  } else if (config.updates.url.replace(/\/+$/, "") !== expected) {
    warn(`updates.url apunta a ${config.updates.url}, no a ${expected}.`);
  }
  const appChannel = config.updates?.requestHeaders?.["expo-channel-name"];
  if (appChannel && appChannel !== channel) warn(`La app pide el canal "${appChannel}" y estás publicando en "${channel}".`);
  for (const [platform, r] of runtimes) {
    info(`Canal ${c.bold(channel)} · ${platform} · runtime ${c.bold(short(r.runtimeVersion))}${policy(config) === "fingerprint" ? " (huella nativa)" : ""}`);
  }
  if (!(await checkCompat(api, channel, runtimes, config, flags))) {
    info("No se publicó nada.");
    return;
  }

  const out = join(tmpdir(), `apron-ota-${Date.now()}`);
  try {
    step("Exportando el JavaScript (npx expo export)…");
    const code = await run(`npx expo export --output-dir "${out}" ${platforms.map((p) => `--platform ${p}`).join(" ")}`, root, env);
    if (code !== 0) fail(`npx expo export terminó con error (código ${code}).`);
    const metadataFile = join(out, "metadata.json");
    if (!existsSync(metadataFile)) fail("La exportación no generó metadata.json.");
    const metadata = JSON.parse(readFileSync(metadataFile, "utf8")) as { fileMetadata: Record<string, { bundle: string; assets: { path: string; ext: string }[] }> };

    const commit = git.commit(root);
    const message = str(flags, "message") ?? (commit ? git.log(root, ["-1", "--format=%s"]).join("") || undefined : undefined);
    // Con la huella, android e ios suelen tener runtimes distintos: se publica una vez por runtime.
    const byRuntime = new Map<string, string[]>();
    for (const [platform, r] of runtimes) byRuntime.set(r.runtimeVersion, [...(byRuntime.get(r.runtimeVersion) ?? []), platform]);
    let published = 0;
    for (const [rv, group] of byRuntime) {
      const files = new Map<string, string>();
      const fileMetadata: typeof metadata.fileMetadata = {};
      for (const platform of group) {
        const meta = metadata.fileMetadata[platform];
        if (!meta) continue;
        fileMetadata[platform] = meta;
        files.set(meta.bundle, join(out, meta.bundle));
        for (const a of meta.assets ?? []) files.set(a.path, join(out, a.path));
      }
      if (files.size === 0) continue;
      const list = [...files.entries()].map(([path, file]) => ({ path: path.replace(/\\/g, "/"), file }));
      step(`Subiendo ${list.length} archivos (${group.join(" + ")})…`);
      const result = await api.publishUpdate({
        channel, runtimeVersion: rv, message: message?.replace(/^- /, "").replace(/ \([0-9a-f]{7,}\)$/, ""),
        commit, branch: git.branch(root),
        metadata: JSON.stringify({ ...metadata, fileMetadata }), expoConfig: JSON.stringify(config),
      }, list);
      published++;
      ok(`Actualización publicada en ${c.bold(result.channel)} (${result.platforms.join(" + ")}), runtime ${short(result.runtimeVersion)}.`);
      info(`Nuevo en el servidor: ${formatSize(result.newBytes)} (los assets repetidos no se vuelven a guardar).`);
      console.log(`  ${c.cyan(result.url)}`);
    }
    if (published === 0) fail("La exportación no trae archivos para esas plataformas.");
    info(`Las apps del canal ${channel} con ese runtime la bajan al abrir y la usan la siguiente vez que abren.`);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

export async function updates() {
  const project = requireProject();
  const auth = resolveAuth(project);
  const list = await new Api(auth.server, auth.token).listUpdates();
  if (list.length === 0) {
    info("Todavía no hay actualizaciones OTA.");
    return;
  }
  const rows = [[c.dim("MENSAJE"), c.dim("CANAL"), c.dim("RUNTIME"), c.dim("PLATAFORMAS"), c.dim("PUBLICADA"), c.dim("ESTADO")]];
  for (const u of list.slice(0, 20)) {
    rows.push([(u.message ?? "—").slice(0, 48), u.channel, u.runtimeVersion, u.platforms.join("+"), ago(u.createdAt), u.rolledBackAt ? c.red("revertida") : c.green("activa")]);
  }
  console.log(table(rows));
}
