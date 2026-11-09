import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectVersion } from "../src/appversion";
import { saveCredential } from "../src/config";
import { buildEnv, easProfileEnv } from "../src/buildenv";
import { detect } from "../src/detect";
import { findFiles } from "../src/glob";
import { findProject, resolveAuth } from "../src/project";

let dir: string;
const env = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hangar-cli-"));
  process.env.HANGAR_CONFIG = join(dir, "config", "config.json");
  delete process.env.HANGAR_TOKEN;
  delete process.env.HANGAR_URL;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...env };
});

function file(path: string, content = "x", mtime?: number) {
  const full = join(dir, path);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  if (mtime) utimesSync(full, mtime, mtime);
  return full;
}

describe("glob", () => {
  test("* dentro de una carpeta, el más nuevo primero", () => {
    file("dist-android/preno-1.0.0-preview.apk", "a", 1000);
    file("dist-android/preno-1.1.0-preview.apk", "b", 2000);
    file("dist-android/preno-1.1.0-development.apk", "c", 3000);
    const found = findFiles(dir, "dist-android/*-preview.apk");
    expect(found.map((f) => f.path.replace(/\\/g, "/").split("/").pop())).toEqual(["preno-1.1.0-preview.apk", "preno-1.0.0-preview.apk"]);
  });

  test("** busca en subcarpetas y no entra a node_modules", () => {
    file("build/a/b/app.msi");
    file("node_modules/x/app.msi");
    expect(findFiles(dir, "build/**/*.msi")).toHaveLength(1);
    expect(findFiles(dir, "**/*.msi")).toHaveLength(1);
  });

  test("ruta exacta y patrón sin coincidencias", () => {
    file("target/app-1.0.jar");
    expect(findFiles(dir, "target/app-1.0.jar")).toHaveLength(1);
    expect(findFiles(dir, "target/*.war")).toHaveLength(0);
    expect(findFiles(dir, "no-existe/*.apk")).toHaveLength(0);
  });
});

describe("versión de la app", () => {
  test("Expo", () => {
    file("app.json", JSON.stringify({ expo: { version: "1.1.0", android: { versionCode: 7 } } }));
    expect(detectVersion(dir)).toEqual({ version: "1.1.0", versionCode: "7" });
  });
  test("Flutter", () => {
    file("pubspec.yaml", "name: demo\nversion: 2.3.4+56\n");
    expect(detectVersion(dir)).toEqual({ version: "2.3.4", versionCode: "56" });
  });
  test("Maven ignora la versión del parent", () => {
    file("pom.xml", "<project><parent><version>4.1.2</version></parent><artifactId>x</artifactId><version>0.3.0</version></project>");
    expect(detectVersion(dir)).toEqual({ version: "0.3.0" });
  });
  test("Android Gradle (kts)", () => {
    file("app/build.gradle.kts", 'android { defaultConfig { versionCode = 12\n versionName = "1.2" } }');
    expect(detectVersion(dir)).toEqual({ version: "1.2", versionCode: "12" });
  });
  test("package.json", () => {
    file("package.json", JSON.stringify({ name: "x", version: "0.9.1" }));
    expect(detectVersion(dir)).toEqual({ version: "0.9.1" });
  });
});

describe("detección del proyecto", () => {
  test("Expo con scripts/build-android.ps1 (como Preno)", () => {
    file("app.json", JSON.stringify({ expo: { name: "Preno", version: "1.0.0" } }));
    file("scripts/build-android.ps1");
    const d = detect(dir);
    expect(d.kind).toBe("expo");
    expect(d.name).toBe("Preno");
    expect(d.profiles.preview?.artifact).toBe("dist-android/*-preview.apk");
    expect(d.profiles.production?.artifact).toBe("dist-android/*-production.aab");
  });
  test("Expo con eas.json usa sus perfiles", () => {
    file("package.json", JSON.stringify({ dependencies: { expo: "54.0.0" } }));
    file("eas.json", JSON.stringify({ build: { development: {}, preview: {}, production: {} } }));
    const profiles = detect(dir).profiles;
    expect(Object.keys(profiles)).toEqual(["development", "preview", "production"]);
    // Cada perfil compila como su perfil de EAS y regenera android/
    expect(profiles.preview?.eas).toBe("preview");
    expect(profiles.production?.build).toContain("expo prebuild --clean");
    expect(profiles.production?.artifact).toEndWith(".aab");
  });
  test("Flutter, Maven y genérico", () => {
    file("pubspec.yaml", "name: mi_app\nversion: 1.0.0\n");
    expect(detect(dir).kind).toBe("flutter");
    rmSync(join(dir, "pubspec.yaml"));
    file("pom.xml", "<project><artifactId>api</artifactId></project>");
    expect(detect(dir).profiles.release?.artifact).toBe("target/*.jar");
    rmSync(join(dir, "pom.xml"));
    expect(detect(dir).kind).toBe("generic");
  });
});

describe("variables del build", () => {
  const eas = {
    build: {
      preview: { env: { EXPO_PUBLIC_API: "https://api.test", EXPO_PUBLIC_MODE: "off" } },
      demo: { extends: "preview", env: { EXPO_PUBLIC_MODE: "demo" } },
      loop: { extends: "loop" },
    },
  };
  const noFail = (msg: string): never => {
    throw new Error(msg);
  };

  test("eas.json: el perfil hereda de extends y gana el suyo", () => {
    file("eas.json", JSON.stringify(eas));
    expect(easProfileEnv(dir, "demo")).toEqual({ EXPO_PUBLIC_API: "https://api.test", EXPO_PUBLIC_MODE: "demo" });
    expect(easProfileEnv(dir, "loop")).toEqual({});
    expect(easProfileEnv(dir, "no-existe")).toBeUndefined();
  });

  test("con eas: sin .env, sin aviso de git y env de hangar.json al final", () => {
    file("eas.json", JSON.stringify(eas));
    process.env.EXPO_PUBLIC_MODE = "demo"; // como si viniera de la terminal
    const { env: out, added } = buildEnv(dir, { eas: "preview", env: { EXPO_PUBLIC_API: "https://local" } }, noFail);
    expect(out.EXPO_PUBLIC_MODE).toBe("off");
    expect(out.EXPO_PUBLIC_API).toBe("https://local");
    expect(out.EXPO_NO_DOTENV).toBe("1");
    expect(out.EXPO_NO_GIT_STATUS).toBe("1");
    expect(added).toContain("EXPO_PUBLIC_MODE");
  });

  test("sin eas no se agrega nada; eas inexistente falla", () => {
    file("eas.json", JSON.stringify(eas));
    expect(buildEnv(dir, { build: "x" }, noFail).added).toEqual([]);
    expect(() => buildEnv(dir, { eas: "otro" }, noFail)).toThrow(/no está en eas.json/);
  });
});

describe("de dónde sale la llave", () => {
  test("hangar login > .hangar.env, y HANGAR_TOKEN gana a todo", () => {
    file("hangar.json", JSON.stringify({ server: "https://panel.test/", project: "preno", profiles: {} }));
    file(".hangar.env", "HANGAR_URL=https://panel.test\nHANGAR_TOKEN=hgr_del_archivo\n");
    const project = findProject(dir)!;
    expect(resolveAuth(project)).toMatchObject({ server: "https://panel.test", token: "hgr_del_archivo", source: ".hangar.env" });

    saveCredential("https://panel.test", "preno", { token: "hgr_del_login", savedAt: new Date().toISOString() });
    expect(resolveAuth(project).token).toBe("hgr_del_login");

    process.env.HANGAR_TOKEN = "hgr_ci";
    expect(resolveAuth(project).token).toBe("hgr_ci");
  });

  test("hangar.json se encuentra desde una subcarpeta", () => {
    file("hangar.json", JSON.stringify({ project: "x", profiles: {} }));
    mkdirSync(join(dir, "src", "deep"), { recursive: true });
    expect(findProject(join(dir, "src", "deep"))?.config.project).toBe("x");
  });

  test("sin llave: error con la pista de hangar login", () => {
    file("hangar.json", JSON.stringify({ server: "https://panel.test", project: "x", profiles: {} }));
    expect(() => resolveAuth(findProject(dir))).toThrow(/No tengo llave/);
  });
});
