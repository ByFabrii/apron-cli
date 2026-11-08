// La versión de la app, según el tipo de proyecto. Si no se encuentra, el panel la saca del APK (si es APK).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface AppVersion {
  version?: string;
  versionCode?: string;
}

function read(root: string, file: string): string | undefined {
  const path = join(root, file);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

function json(root: string, file: string): Record<string, unknown> | undefined {
  const text = read(root, file);
  if (!text) return undefined;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function detectVersion(root: string): AppVersion {
  // Expo / React Native: app.json → expo.version y expo.android.versionCode
  const app = json(root, "app.json") as { expo?: { version?: string; android?: { versionCode?: number } } } | undefined;
  if (app?.expo?.version) {
    return { version: app.expo.version, versionCode: app.expo.android?.versionCode?.toString() };
  }
  // Flutter: pubspec.yaml → "version: 1.2.3+45"
  const pubspec = read(root, "pubspec.yaml");
  const flutter = pubspec && /^version:\s*([^\s+]+)(?:\+(\d+))?/m.exec(pubspec);
  if (flutter) return { version: flutter[1], versionCode: flutter[2] };
  // Android nativo: app/build.gradle(.kts) → versionName / versionCode
  for (const file of ["app/build.gradle.kts", "app/build.gradle"]) {
    const gradle = read(root, file);
    if (!gradle) continue;
    const name = /versionName\s*=?\s*"([^"]+)"/.exec(gradle)?.[1];
    const code = /versionCode\s*=?\s*(\d+)/.exec(gradle)?.[1];
    if (name || code) return { version: name, versionCode: code };
  }
  // Maven: la <version> del proyecto (no la del <parent>)
  const pom = read(root, "pom.xml");
  if (pom) {
    const withoutParent = pom.replace(/<parent>[\s\S]*?<\/parent>/, "").replace(/<dependencies>[\s\S]*<\/dependencies>/, "");
    const v = /<version>([^<]+)<\/version>/.exec(withoutParent)?.[1];
    if (v && !v.includes("${")) return { version: v };
  }
  // Gradle (JVM): version = "1.0.0"
  for (const file of ["build.gradle.kts", "build.gradle"]) {
    const v = /^\s*version\s*=\s*["']([^"']+)["']/m.exec(read(root, file) ?? "")?.[1];
    if (v) return { version: v };
  }
  // Node / Electron / Tauri: package.json → version
  const pkg = json(root, "package.json") as { version?: string } | undefined;
  if (pkg?.version) return { version: pkg.version };
  return {};
}
