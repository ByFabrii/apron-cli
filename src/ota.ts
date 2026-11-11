// apron update: publica una actualización OTA (expo-updates) en el panel.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Api } from "./api";
import { buildEnv, clearMetroCache, easProfileEnv } from "./buildenv";
import * as git from "./git";
import { requireProject, resolveAuth, type LoadedProject, type ProfileConfig } from "./project";
import { c, fail, formatSize, info, ok, relative as ago, step, table, warn } from "./ui";

type Flags = Record<string, string | boolean>;
const str = (flags: Flags, name: string) => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);

interface ExpoConfig {
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
function expoConfig(root: string, env: NodeJS.ProcessEnv): ExpoConfig {
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

function runtimeVersion(config: ExpoConfig, flags: Flags): string {
  const forced = str(flags, "runtime-version");
  if (forced) return forced;
  const rv = config.runtimeVersion;
  if (typeof rv === "string" && rv) return rv;
  if (rv && typeof rv === "object") {
    if (rv.policy === "appVersion" && config.version) return config.version;
    fail(`runtimeVersion usa la política "${rv.policy}", que el CLI aún no calcula.`,
      "Usa { \"policy\": \"appVersion\" } en app.json, o pásalo a mano con --runtime-version.");
  }
  fail("app.json no tiene runtimeVersion.", "Agrega \"runtimeVersion\": { \"policy\": \"appVersion\" } dentro de \"expo\" y compila un APK nuevo.");
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
  const rv = runtimeVersion(config, flags);
  const expected = `${auth.server}/ota/${me.slug}/manifest`;
  if (!config.updates?.url) {
    warn(`app.json no tiene updates.url: las apps no van a buscar actualizaciones. Debe ser ${expected}`);
  } else if (config.updates.url.replace(/\/+$/, "") !== expected) {
    warn(`updates.url apunta a ${config.updates.url}, no a ${expected}.`);
  }
  const appChannel = config.updates?.requestHeaders?.["expo-channel-name"];
  if (appChannel && appChannel !== channel) warn(`La app pide el canal "${appChannel}" y estás publicando en "${channel}".`);
  info(`Canal ${c.bold(channel)} · runtime ${c.bold(rv)} · ${platforms.join(" + ")}`);

  const out = join(tmpdir(), `apron-ota-${Date.now()}`);
  try {
    step("Exportando el JavaScript (npx expo export)…");
    const code = await run(`npx expo export --output-dir "${out}" ${platforms.map((p) => `--platform ${p}`).join(" ")}`, root, env);
    if (code !== 0) fail(`npx expo export terminó con error (código ${code}).`);
    const metadataFile = join(out, "metadata.json");
    if (!existsSync(metadataFile)) fail("La exportación no generó metadata.json.");
    const metadata = JSON.parse(readFileSync(metadataFile, "utf8")) as { fileMetadata: Record<string, { bundle: string; assets: { path: string; ext: string }[] }> };

    const files = new Map<string, string>();
    for (const platform of platforms) {
      const meta = metadata.fileMetadata[platform];
      if (!meta) continue;
      files.set(meta.bundle, join(out, meta.bundle));
      for (const a of meta.assets ?? []) files.set(a.path, join(out, a.path));
    }
    if (files.size === 0) fail("La exportación no trae archivos para esas plataformas.");
    const list = [...files.entries()].map(([path, file]) => ({ path: path.replace(/\\/g, "/"), file }));

    const commit = git.commit(root);
    const message = str(flags, "message") ?? (commit ? git.log(root, ["-1", "--format=%s"]).join("") || undefined : undefined);
    step(`Subiendo ${list.length} archivos…`);
    const published = await api.publishUpdate({
      channel, runtimeVersion: rv, message: message?.replace(/^- /, "").replace(/ \([0-9a-f]{7,}\)$/, ""),
      commit, branch: git.branch(root),
      metadata: JSON.stringify(metadata), expoConfig: JSON.stringify(config),
    }, list);
    ok(`Actualización publicada en ${c.bold(published.channel)} (${published.platforms.join(" + ")}), runtime ${published.runtimeVersion}.`);
    info(`Nuevo en el servidor: ${formatSize(published.newBytes)} (los assets repetidos no se vuelven a guardar).`);
    info(`Las apps del canal ${published.channel} con runtime ${published.runtimeVersion} la bajan la próxima vez que abran.`);
    console.log(`  ${c.cyan(published.url)}`);
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
