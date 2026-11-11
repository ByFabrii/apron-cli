// Cliente HTTP del panel. Usa fetch (Node 18+ y Bun) y sube archivos sin cargarlos completos en memoria.
import { openAsBlob, statSync } from "node:fs";
import { basename } from "node:path";
import { VERSION } from "./version";
import { fail } from "./ui";
import { INSTALL } from "./updatecheck";

export interface BuildInfo {
  id: string;
  project: string;
  fileName: string;
  sizeBytes: number;
  sha256: string;
  platform: string;
  profile?: string;
  version?: string;
  versionCode?: string;
  commit?: string;
  branch?: string;
  pinned: boolean;
  createdAt: string;
  url: string;
  downloadUrl: string;
  appId?: string;
  signerSha256?: string;
}

export interface UploadFields {
  profile?: string;
  version?: string;
  versionCode?: string;
  commit?: string;
  branch?: string;
  notes?: string;
  platform?: string;
  runtimeVersion?: string;
  otaChannel?: string;
  fingerprint?: string;
}

export interface BuildRef {
  id: string;
  label: string;
  createdAt: string;
  runtimeVersion: string;
}

export interface OtaCompat {
  channel: string;
  platform: string;
  runtimeVersion: string;
  devices: number;
  compatible: number;
  runtimes: { runtimeVersion: string; devices: number; failing: number; lastSeen: string; build?: BuildRef | null }[];
  matchingBuild?: BuildRef | null;
  reference?: BuildRef | null;
  referenceFingerprint?: string | null;
}

const USER_AGENT = `apron-cli/${VERSION} (${process.platform}; ${process.arch})`;

export class Api {
  constructor(readonly server: string, private readonly token?: string) {}

  private async request<T>(method: string, path: string, body?: BodyInit, query?: Record<string, string | undefined>): Promise<T> {
    const url = new URL(this.server + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== "") url.searchParams.set(k, v);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        body,
        headers: { "User-Agent": USER_AGENT, ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
      });
    } catch (e) {
      fail(`No pude conectarme a ${this.server}: ${(e as Error).message}`, "Revisa la URL y tu conexión.");
    }
    const text = await response.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!response.ok) {
      const message = (json as { message?: string } | undefined)?.message;
      if (response.status === 401) fail("El panel rechazó la llave (no existe o fue revocada).", "Corre `apron login` otra vez.");
      if (response.status === 413) fail(message ?? "El archivo es más grande que el máximo del panel.");
      if (response.status === 426) fail(message ?? "Este apron es muy viejo para el panel.", `Actualiza con: ${INSTALL}`);
      fail(message ?? `El panel respondió ${response.status} en ${method} ${path}.`);
    }
    return json as T;
  }

  whoami() {
    return this.request<{ slug: string; name: string; token: string; url: string }>("GET", "/api/v1/project");
  }

  list(profile?: string, limit = 20) {
    return this.request<BuildInfo[]>("GET", "/api/v1/builds", undefined, { profile, limit: String(limit) });
  }

  async latest(profile?: string): Promise<BuildInfo | undefined> {
    const list = await this.list(profile, 1);
    return list[0];
  }

  share(buildId: string, hours?: number) {
    return this.request<{ url: string; expiresAt: string; build: BuildInfo }>(
      "POST", `/api/v1/builds/${encodeURIComponent(buildId)}/shares`, undefined, { hours: hours ? String(hours) : undefined });
  }

  async upload(file: string, fields: UploadFields): Promise<BuildInfo> {
    const form = new FormData();
    // openAsBlob lee el archivo por partes al enviarlo: un APK de 100 MB no se carga entero en memoria.
    const blob = typeof Bun !== "undefined" ? Bun.file(file) : await openAsBlob(file);
    form.append("file", blob, basename(file));
    for (const [key, value] of Object.entries(fields)) if (value) form.append(key, value);
    return this.request<BuildInfo>("POST", "/api/v1/builds", form);
  }

  // --- Actualizaciones OTA --------------------------------------------------------------------

  async publishUpdate(fields: Record<string, string | undefined>, files: { path: string; file: string }[]) {
    const form = new FormData();
    for (const [key, value] of Object.entries(fields)) if (value) form.append(key, value);
    form.append("paths", JSON.stringify(files.map((f) => f.path)));
    for (let i = 0; i < files.length; i++) {
      const f = files[i]!;
      const blob = typeof Bun !== "undefined" ? Bun.file(f.file) : await openAsBlob(f.file);
      form.append(`f${i}`, blob, `f${i}`);
    }
    return this.request<{ groupId: string; channel: string; runtimeVersion: string; platforms: string[]; newBytes: number; url: string; manifestUrl: string }>(
      "POST", "/api/v1/ota/updates", form);
  }

  /** A cuántos dispositivos les llegaría una actualización con ese runtime. undefined si el panel es viejo. */
  async otaCompat(channel: string, platform: string, runtimeVersion: string): Promise<OtaCompat | undefined> {
    try {
      return await this.request<OtaCompat>("GET", "/api/v1/ota/compat", undefined, { channel, platform, runtimeVersion });
    } catch {
      return undefined;
    }
  }

  listUpdates() {
    return this.request<{ groupId: string; channel: string; runtimeVersion: string; platforms: string[]; message?: string; createdAt: string; rolledBackAt?: string; sizeBytes: number }[]>(
      "GET", "/api/v1/ota/updates");
  }

  // --- Login con el navegador (no lleva llave) ----------------------------------------------

  loginStart(client: string, project?: string) {
    return this.request<{ deviceCode: string; userCode: string; verificationUri: string; verificationUriComplete: string; interval: number; expiresAt: string }>(
      "POST", "/api/v1/cli/login/start", undefined, { client, project });
  }

  loginPoll(deviceCode: string) {
    return this.request<{ status: "pending" | "approved" | "denied" | "expired"; token?: string; project?: string; projectName?: string; server?: string }>(
      "POST", "/api/v1/cli/login/poll", undefined, { deviceCode });
  }
}

export function fileSize(file: string): number {
  return statSync(file).size;
}
