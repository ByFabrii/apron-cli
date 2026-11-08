import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { Api, fileSize, type BuildInfo } from "./api";
import { detectVersion } from "./appversion";
import { configPath, loadConfig, normalizeServer, removeCredential, saveConfig, saveCredential } from "./config";
import { detect } from "./detect";
import * as git from "./git";
import { findFiles } from "./glob";
import { autoNotes } from "./notes";
import { findProject, requireProject, resolveAuth, resolveServer, writeProject, PROJECT_FILE, type LoadedProject, type ProjectConfig } from "./project";
import { machineName, openUrl, terminalQr } from "./system";
import { ask, c, fail, formatSize, info, interactive, ok, relative as ago, step, table, warn } from "./ui";
import { VERSION } from "./version";

export type Flags = Record<string, string | boolean>;

const str = (flags: Flags, name: string): string | undefined => (typeof flags[name] === "string" ? (flags[name] as string) : undefined);

// --- init -------------------------------------------------------------------------------------

export async function init(flags: Flags) {
  const root = process.cwd();
  const existing = findProject(root);
  if (existing && existing.root === root && !flags.force) {
    fail(`Ya existe ${PROJECT_FILE} en esta carpeta.`, "Edítalo a mano o usa `hangar init --force` para crearlo de nuevo.");
  }
  const detected = detect(root);
  step(`Proyecto detectado: ${c.bold(detected.label)}`);

  const server = normalizeServer(str(flags, "server") ?? (await ask("URL de tu panel Hangar:", resolveServer() ?? undefined)));
  if (!server || server === "https://") fail("Necesito la URL del panel.");
  const slugSuggestion = detected.name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const project = str(flags, "project") ?? (await ask("Identificador del proyecto en Hangar:", slugSuggestion || "mi-app"));

  const profiles = detected.profiles;
  for (const [name, profile] of Object.entries(profiles)) {
    if (!profile.build && interactive()) profile.build = await ask(`Comando que compila "${name}":`);
    if (!profile.artifact && interactive()) profile.artifact = await ask(`Archivo que genera "${name}" (admite * y **):`);
  }

  const config: ProjectConfig = { server, project, profiles };
  const file = writeProject(root, config);
  ok(`Creé ${relative(process.cwd(), file) || file}`);
  for (const [name, p] of Object.entries(profiles)) {
    info(`${name}: ${p.build || "(sin comando)"} → ${p.artifact || "(sin archivo)"}`);
  }
  console.log(`\nSiguiente: ${c.bold("hangar login")} para autorizar esta terminal, y luego ${c.bold(`hangar build ${Object.keys(profiles)[0] ?? "release"}`)}.`);
  console.log(c.dim(`${PROJECT_FILE} no tiene secretos: súbelo al repo. Ajusta los comandos si tu proyecto compila distinto.`));
}

// --- login / logout / whoami ------------------------------------------------------------------

export async function login(flags: Flags) {
  const project = findProject();
  const server = normalizeServer(str(flags, "server") ?? resolveServer(project) ?? (await ask("URL de tu panel Hangar:")));
  const api = new Api(server);
  const start = await api.loginStart(machineName(), str(flags, "project") ?? project?.config.project);

  console.log(`\nAbre ${c.cyan(start.verificationUri)} y escribe este código:\n`);
  console.log(`    ${c.bold(start.userCode)}\n`);
  if (!flags["no-browser"] && openUrl(start.verificationUriComplete)) info("Abrí el navegador por ti.");
  step("Esperando la autorización en el panel… (Ctrl+C para cancelar)");

  const deadline = new Date(start.expiresAt).getTime();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, Math.max(1, start.interval) * 1000));
    const poll = await api.loginPoll(start.deviceCode);
    if (poll.status === "pending") continue;
    if (poll.status === "denied") fail("Rechazaste el acceso en el panel.");
    if (poll.status === "expired") fail("El código venció. Corre `hangar login` otra vez.");
    if (poll.status === "approved" && poll.token && poll.project) {
      saveCredential(server, poll.project, { token: poll.token, projectName: poll.projectName, savedAt: new Date().toISOString() });
      ok(`Conectado a ${c.bold(poll.projectName ?? poll.project)} (${poll.project}) en ${server}.`);
      info(`La llave quedó en ${configPath()} (solo en este equipo).`);
      if (project && project.config.project !== poll.project) {
        warn(`Autorizaste "${poll.project}", pero ${PROJECT_FILE} dice "${project.config.project}". Cambia uno de los dos.`);
      }
      return;
    }
  }
  fail("Se acabó el tiempo para autorizar. Corre `hangar login` otra vez.");
}

export async function logout() {
  const project = requireProject();
  const server = resolveServer(project);
  if (!server) fail("No sé de qué panel cerrar sesión.");
  if (removeCredential(server, project.config.project)) ok(`Se borró la llave de "${project.config.project}" en este equipo.`);
  else info("No había una llave guardada para este proyecto.");
  info("Para invalidarla del todo, revócala en el panel: Configuración y llaves.");
}

export async function whoami() {
  const project = findProject();
  const auth = resolveAuth(project);
  const me = await new Api(auth.server, auth.token).whoami();
  ok(`${c.bold(me.name)} (${me.slug}) en ${auth.server}`);
  info(`Llave "${me.token}", desde ${auth.source}.`);
}

// --- upload / build ---------------------------------------------------------------------------

async function uploadFile(project: LoadedProject | undefined, file: string, flags: Flags, profile?: string): Promise<BuildInfo> {
  const auth = resolveAuth(project);
  const api = new Api(auth.server, auth.token);
  const root = project?.root ?? process.cwd();
  const commit = git.commit(root);
  const version = detectVersion(root);
  const notes = str(flags, "notes") ?? (flags["no-notes"] ? undefined : await autoNotes(api, root, profile, commit));

  step(`Subiendo ${c.bold(basename(file))} (${formatSize(fileSize(file))}) a ${auth.server}…`);
  if (notes) notes.split("\n").slice(0, 8).forEach((l) => info(l));
  const started = Date.now();
  const build = await api.upload(file, {
    profile,
    version: str(flags, "version") ?? version.version,
    versionCode: str(flags, "version-code") ?? version.versionCode,
    commit,
    branch: git.branch(root),
    notes,
    platform: str(flags, "platform"),
  });
  ok(`Subido en ${((Date.now() - started) / 1000).toFixed(1)} s: ${c.cyan(build.url)}`);
  return build;
}

export async function upload(args: string[], flags: Flags) {
  const file = args[0];
  if (!file) fail("Falta el archivo.", "Uso: hangar upload <archivo> [--profile preview] [--notes \"…\"]");
  const path = resolve(file);
  if (!existsSync(path)) fail(`No existe ${file}.`);
  const project = findProject();
  await uploadFile(project, path, flags, str(flags, "profile"));
}

export async function build(args: string[], flags: Flags) {
  const project = requireProject();
  const names = Object.keys(project.config.profiles);
  const profileName = args[0] ?? (names.length === 1 ? names[0] : undefined);
  if (!profileName) fail("¿Qué perfil compilo?", `Uso: hangar build <perfil>. Perfiles en ${PROJECT_FILE}: ${names.join(", ") || "(ninguno)"}`);
  const profile = project.config.profiles[profileName];
  if (!profile) fail(`El perfil "${profileName}" no está en ${PROJECT_FILE}.`, `Perfiles: ${names.join(", ")}`);
  if (!profile.artifact) fail(`El perfil "${profileName}" no dice dónde queda el archivo ("artifact").`);

  // Si no se va a subir, no hace falta llave; si sí, se revisa ANTES de compilar.
  if (!flags["no-upload"]) {
    const auth = resolveAuth(project);
    const me = await new Api(auth.server, auth.token).whoami();
    ok(`Panel: ${me.name} (${me.slug})`);
    if (me.slug !== project.config.project) warn(`La llave es de "${me.slug}" y ${PROJECT_FILE} dice "${project.config.project}".`);
  }
  if (git.isDirty(project.root)) warn("Hay cambios sin commit: el commit que se registra no los incluye.");

  const started = Date.now();
  if (profile.build && !flags["skip-build"]) {
    step(`Compilando ${c.bold(profileName)}: ${c.dim(profile.build)}`);
    const code = await run(profile.build, project.root);
    if (code !== 0) fail(`La compilación terminó con error (código ${code}).`);
  }
  const candidates = findFiles(project.root, profile.artifact);
  const fresh = flags["skip-build"] || !profile.build ? candidates : candidates.filter((f) => f.mtimeMs >= started - 5000);
  const artifact = fresh[0];
  if (!artifact) {
    fail(`No encontré el archivo "${profile.artifact}"${profile.build && !flags["skip-build"] ? " generado por esta compilación" : ""}.`,
      `Revisa "artifact" del perfil ${profileName} en ${PROJECT_FILE}.`);
  }
  ok(`Archivo: ${relative(project.root, artifact.path)} (${formatSize(artifact.size)})`);
  if (flags["no-upload"]) return;
  await uploadFile(project, artifact.path, flags, profileName);
}

function run(command: string, cwd: string): Promise<number> {
  return new Promise((resolvePromise) => {
    const child = spawn(command, { cwd, shell: true, stdio: "inherit" });
    child.on("error", () => resolvePromise(127));
    child.on("close", (code) => resolvePromise(code ?? 1));
  });
}

// --- list / share / open ----------------------------------------------------------------------

export async function list(flags: Flags) {
  const project = findProject();
  const auth = resolveAuth(project);
  const builds = await new Api(auth.server, auth.token).list(str(flags, "profile"), Number(str(flags, "limit") ?? 15));
  if (builds.length === 0) {
    info("Todavía no hay builds.");
    return;
  }
  const rows = [[c.dim("VERSIÓN"), c.dim("PERFIL"), c.dim("TAMAÑO"), c.dim("SUBIDO"), c.dim("ID")]];
  for (const b of builds) {
    const label = (b.version ?? "sin versión") + (b.versionCode ? ` (${b.versionCode})` : "");
    rows.push([c.bold(label), b.profile ?? "—", formatSize(b.sizeBytes), ago(b.createdAt), c.dim(b.id.slice(0, 8))]);
  }
  console.log(table(rows));
}

async function pickBuild(api: Api, idOrPrefix: string | undefined, profile: string | undefined): Promise<BuildInfo> {
  if (!idOrPrefix || idOrPrefix === "latest") {
    const latest = await api.latest(profile);
    if (!latest) fail(profile ? `No hay builds del perfil ${profile}.` : "Todavía no hay builds.");
    return latest;
  }
  const found = (await api.list(profile, 100)).filter((b) => b.id.startsWith(idOrPrefix));
  if (found.length === 0) fail(`No encontré un build que empiece con "${idOrPrefix}".`, "Usa `hangar list` para ver los ID.");
  if (found.length > 1) fail(`"${idOrPrefix}" coincide con varios builds; escribe más caracteres del ID.`);
  return found[0]!;
}

export async function share(args: string[], flags: Flags) {
  const project = findProject();
  const auth = resolveAuth(project);
  const api = new Api(auth.server, auth.token);
  const target = await pickBuild(api, args[0], str(flags, "profile"));
  const hours = str(flags, "hours") ? Number(str(flags, "hours")) : undefined;
  if (hours !== undefined && (!Number.isInteger(hours) || hours < 1 || hours > 720)) fail("--hours va de 1 a 720 (30 días).");
  const created = await api.share(target.id, hours);
  ok(`Enlace para ${c.bold((target.version ?? target.fileName) + (target.profile ? ` · ${target.profile}` : ""))}, vence ${new Date(created.expiresAt).toLocaleString()}:`);
  console.log(`\n  ${c.cyan(created.url)}\n`);
  // El QR solo tiene sentido en una terminal (no al redirigir la salida a un archivo).
  if (!flags["no-qr"] && process.stdout.isTTY) console.log(await terminalQr(created.url));
}

export async function open(args: string[], flags: Flags) {
  const project = findProject();
  const server = resolveServer(project);
  if (!server) fail("No sé qué panel abrir.");
  let url = project ? `${server}/projects/${project.config.project}` : server;
  if (args[0] === "settings" && project) url += "/settings";
  if (args[0] === "latest" && project) url += `/latest${str(flags, "profile") ? `?profile=${encodeURIComponent(str(flags, "profile")!)}` : ""}`;
  openUrl(url);
  ok(url);
}

// --- doctor / config --------------------------------------------------------------------------

export async function doctor() {
  let problems = 0;
  const check = (good: boolean, okText: string, badText: string) => {
    if (good) ok(okText);
    else {
      problems++;
      warn(badText);
    }
  };
  console.log(`Hangar CLI ${VERSION} · ${process.platform}-${process.arch}`);
  const project = findProject();
  check(Boolean(project), `${PROJECT_FILE}: ${project?.file}`, `No hay ${PROJECT_FILE} aquí ni más arriba (hangar init).`);
  const server = resolveServer(project);
  check(Boolean(server), `Panel: ${server}`, "Sin panel configurado (hangar config server <url>).");
  check(Boolean(git.commit(project?.root ?? process.cwd())), "Repositorio git: sí", "No es un repositorio git: no habrá commit ni notas automáticas.");
  if (server) {
    try {
      const auth = resolveAuth(project);
      const me = await new Api(auth.server, auth.token).whoami();
      check(!project || me.slug === project.config.project, `Llave válida para ${me.name} (${me.slug}), desde ${auth.source}`,
        `La llave es de "${me.slug}", pero ${PROJECT_FILE} dice "${project?.config.project}".`);
    } catch (e) {
      check(false, "", (e as Error).message);
    }
  }
  if (project) {
    for (const [name, p] of Object.entries(project.config.profiles)) {
      check(Boolean(p.artifact), `Perfil ${name}: ${p.build ?? "(sin comando)"} → ${p.artifact}`, `Perfil ${name}: falta "artifact".`);
    }
  }
  console.log(problems === 0 ? c.green("\nTodo listo.") : c.yellow(`\n${problems} cosa(s) por revisar.`));
  if (problems > 0) process.exitCode = 1;
}

export async function config(args: string[]) {
  const [key, value] = args;
  const current = loadConfig();
  if (key === "server" && value) {
    current.server = normalizeServer(value);
    saveConfig(current);
    ok(`Panel por omisión: ${current.server}`);
    return;
  }
  if (key === "server") {
    console.log(current.server ?? "(sin panel por omisión)");
    return;
  }
  console.log(`Archivo: ${configPath()}`);
  console.log(`Panel por omisión: ${current.server ?? "(ninguno)"}`);
  for (const [server, projects] of Object.entries(current.credentials)) {
    for (const [slug, cred] of Object.entries(projects)) console.log(`  ${server}  ${slug}  ${c.dim(`desde ${cred.savedAt.slice(0, 10)}`)}`);
  }
}
