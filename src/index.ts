#!/usr/bin/env node
// Apron CLI: compila y sube builds de cualquier proyecto a tu panel Apron.
import * as cmd from "./commands";
import * as ota from "./ota";
import { c, CliError } from "./ui";
import { VERSION } from "./version";

const HELP = `${c.bold("Apron CLI")} ${VERSION}: tus builds, en tu servidor.

${c.bold("Uso")}
  apron init                    Detecta el proyecto y crea apron.json
  apron login                   Autoriza esta terminal desde el navegador
  apron build <perfil>          Compila con el comando del perfil y sube el archivo
  apron upload <archivo>        Sube un archivo ya compilado
  apron list                    Últimos builds del proyecto
  apron share [id|latest]       Enlace para compartir (con QR) del build
  apron update                  Publica una actualización OTA (Expo): JS nuevo sin otro APK
  apron updates                 Últimas actualizaciones OTA
  apron open [settings|latest]  Abre el proyecto en el panel
  apron whoami                  A qué proyecto sube esta terminal
  apron doctor                  Revisa que todo esté listo
  apron logout                  Borra la llave de este proyecto en este equipo
  apron config [server <url>]   Panel por omisión y llaves guardadas

${c.bold("Opciones")}
  --profile <p>        Perfil (upload, list, share, open latest)
  --notes "<texto>"    Notas del build (si no, se arman con los commits)
  --no-notes           No mandar notas
  --version <v>        Versión (si no, se lee de app.json, pubspec, Gradle, pom o package.json)
  --version-code <n>   Código de versión
  --no-upload          build: solo compilar
  --skip-build         build: no compilar, subir el último archivo existente
  --hours <n>          share: horas que dura el enlace (1 a 720)
  --no-qr              share: sin QR
  --channel <c>        update: canal de la app (preview, production…). Por omisión: production
  --message "<texto>"  update: descripción (por omisión, el último commit)
  --platform <p>       update: android, ios o all (por omisión)
  --runtime-version <v> update: si app.json no usa la política appVersion
  --server <url>       init/login: URL del panel
  --project <slug>     init/login: identificador del proyecto

${c.bold("Variables")}
  APRON_TOKEN, APRON_URL     Para CI/CD: llave y panel sin apron login
  NO_COLOR                   Sin colores
`;

function parse(argv: string[]): { command?: string; args: string[]; flags: cmd.Flags } {
  const args: string[] = [];
  const flags: cmd.Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--")) {
      const [name, inline] = token.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
      if (inline !== undefined) flags[name] = inline;
      else if (!name.startsWith("no-") && argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("-") && takesValue(name)) flags[name] = argv[++i]!;
      else flags[name] = true;
    } else if (token === "-h") {
      flags.help = true;
    } else if (token === "-v") {
      flags.version = true;
    } else {
      args.push(token);
    }
  }
  return { command: args.shift(), args, flags };
}

function takesValue(name: string): boolean {
  return ["profile", "notes", "version", "version-code", "hours", "server", "project", "platform", "limit", "channel", "message", "runtime-version"].includes(name);
}

async function main() {
  const { command, args, flags } = parse(process.argv.slice(2));
  if (flags.version === true && !command) return console.log(`apron ${VERSION}`);
  if (!command || flags.help || command === "help") return console.log(HELP);
  switch (command) {
    case "init": return cmd.init(flags);
    case "login": return cmd.login(flags);
    case "logout": return cmd.logout();
    case "whoami": return cmd.whoami();
    case "build": return cmd.build(args, flags);
    case "upload": return cmd.upload(args, flags);
    case "list": case "ls": return cmd.list(flags);
    case "share": return cmd.share(args, flags);
    case "update": return ota.update(flags);
    case "updates": return ota.updates();
    case "open": return cmd.open(args, flags);
    case "doctor": return cmd.doctor();
    case "config": return cmd.config(args);
    default:
      throw new CliError(`No conozco el comando "${command}".`, "Corre `apron help` para ver los comandos.");
  }
}

main().catch((error: unknown) => {
  if (error instanceof CliError) {
    console.error(`${c.red("✖")} ${error.message}`);
    if (error.hint) console.error(`  ${c.dim(error.hint)}`);
  } else {
    console.error(`${c.red("✖")} Error inesperado: ${(error as Error)?.stack ?? String(error)}`);
  }
  process.exit(1);
});
