// Reconoce el tipo de proyecto y propone perfiles (comando de build + dónde queda el archivo).
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { ProfileConfig } from "./project";

export interface Detected {
  kind: string;
  label: string;
  name: string;
  profiles: Record<string, ProfileConfig>;
}

const isWindows = process.platform === "win32";
const gradlew = isWindows ? "gradlew.bat" : "./gradlew";
const mvnw = isWindows ? "mvnw.cmd" : "./mvnw";

/** Instalador de escritorio típico del sistema donde se compila. */
function desktopExt(): string {
  return isWindows ? "msi" : process.platform === "darwin" ? "dmg" : "AppImage";
}

function has(root: string, ...files: string[]): boolean {
  return files.some((f) => existsSync(join(root, f)));
}

function readJson(root: string, file: string): any {
  try {
    return JSON.parse(readFileSync(join(root, file), "utf8"));
  } catch {
    return undefined;
  }
}

export function detect(root: string): Detected {
  const pkg = readJson(root, "package.json");
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) } as Record<string, string>;
  const name = (pkg?.name as string | undefined) ?? basename(root);

  // Expo / React Native
  const app = readJson(root, "app.json");
  if (app?.expo || deps.expo) {
    const appName = (app?.expo?.name as string | undefined) ?? name;
    // Preno y proyectos parecidos: si ya hay un script de build local, se usa ese.
    if (has(root, "scripts/build-android.ps1")) {
      const ps = (profile: string) => `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 ${profile}`;
      return {
        kind: "expo", label: "Expo / React Native (con scripts/build-android.ps1)", name: appName,
        profiles: {
          preview: { build: ps("preview"), artifact: "dist-android/*-preview.apk" },
          development: { build: ps("development"), artifact: "dist-android/*-development.apk" },
          production: { build: ps("production"), artifact: "dist-android/*-production.aab" },
        },
      };
    }
    const eas = readJson(root, "eas.json");
    const easProfiles = Object.keys(eas?.build ?? {});
    const profiles: Record<string, ProfileConfig> = {};
    // --clean: sin él, si android/ ya existe, prebuild no aplica cambios de app.json (versión, permisos...)
    const prebuild = "npx expo prebuild --clean --platform android";
    for (const p of easProfiles.length ? easProfiles : ["preview"]) {
      profiles[p] = {
        // Con "eas" el build usa las variables de ese perfil de eas.json, como en EAS (buildenv.ts)
        ...(easProfiles.length ? { eas: p } : {}),
        ...(p === "production"
          ? { build: `${prebuild} && cd android && ${gradlew} bundleRelease`, artifact: "android/app/build/outputs/bundle/release/*.aab" }
          : { build: `${prebuild} && cd android && ${gradlew} assembleRelease`, artifact: "android/app/build/outputs/apk/release/*.apk" }),
      };
    }
    return { kind: "expo", label: "Expo / React Native", name: appName, profiles };
  }

  // React Native sin Expo
  if (deps["react-native"] && has(root, "android/gradlew", "android/gradlew.bat")) {
    return {
      kind: "react-native", label: "React Native", name,
      profiles: { release: { build: `cd android && ${gradlew} assembleRelease`, artifact: "android/app/build/outputs/apk/release/*.apk" } },
    };
  }

  // Flutter
  if (has(root, "pubspec.yaml")) {
    const pubspec = readFileSync(join(root, "pubspec.yaml"), "utf8");
    const flutterName = /^name:\s*(\S+)/m.exec(pubspec)?.[1] ?? name;
    return {
      kind: "flutter", label: "Flutter", name: flutterName,
      profiles: {
        release: { build: "flutter build apk --release", artifact: "build/app/outputs/flutter-apk/app-release.apk" },
        appbundle: { build: "flutter build appbundle", artifact: "build/app/outputs/bundle/release/*.aab" },
      },
    };
  }

  // Android nativo (Gradle con módulo app)
  if (has(root, "app/build.gradle", "app/build.gradle.kts") && has(root, "gradlew", "gradlew.bat")) {
    return {
      kind: "android", label: "Android (Gradle)", name,
      profiles: {
        debug: { build: `${gradlew} assembleDebug`, artifact: "app/build/outputs/apk/debug/*.apk" },
        release: { build: `${gradlew} assembleRelease`, artifact: "app/build/outputs/apk/release/*.apk" },
      },
    };
  }

  // Tauri
  if (has(root, "src-tauri/tauri.conf.json")) {
    return {
      kind: "tauri", label: "Tauri", name,
      profiles: { release: { build: "npm run tauri build", artifact: `src-tauri/target/release/bundle/**/*.${desktopExt()}` } },
    };
  }

  // Electron (electron-builder)
  if (deps.electron) {
    return {
      kind: "electron", label: "Electron", name,
      profiles: { release: { build: "npm run dist", artifact: `dist/**/*.${desktopExt() === "msi" ? "exe" : desktopExt()}` } },
    };
  }

  // Java con Maven
  if (has(root, "pom.xml")) {
    const artifactId = /<artifactId>([^<]+)<\/artifactId>/.exec(
      readFileSync(join(root, "pom.xml"), "utf8").replace(/<parent>[\s\S]*?<\/parent>/, ""))?.[1] ?? name;
    return {
      kind: "maven", label: "Java (Maven)", name: artifactId,
      profiles: { release: { build: has(root, "mvnw", "mvnw.cmd") ? `${mvnw} -B -q package -DskipTests` : "mvn -B -q package -DskipTests", artifact: "target/*.jar" } },
    };
  }

  // Java con Gradle
  if (has(root, "build.gradle", "build.gradle.kts")) {
    return {
      kind: "gradle", label: "Java (Gradle)", name,
      profiles: { release: { build: has(root, "gradlew", "gradlew.bat") ? `${gradlew} build -x test` : "gradle build -x test", artifact: "build/libs/*.jar" } },
    };
  }

  // Node con script de build
  if (pkg?.scripts?.build) {
    return { kind: "node", label: "Node", name, profiles: { release: { build: "npm run build", artifact: "dist/**/*.zip" } } };
  }

  return { kind: "generic", label: "Proyecto genérico", name, profiles: { release: { build: "", artifact: "" } } };
}
