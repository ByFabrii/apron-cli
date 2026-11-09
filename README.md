# Hangar CLI

Compila y sube builds de cualquier proyecto (Expo/React Native, Flutter, Android, Java, Electron, Tauri, Node…) a tu
panel Hangar. Es un solo ejecutable: no necesita Node, Java ni nada más instalado.

## Instalar

```powershell
irm https://hangar.fabrizziodev.com/install.ps1 | iex      # Windows
```
```bash
curl -fsSL https://hangar.fabrizziodev.com/install.sh | sh   # macOS / Linux
```

Opciones del instalador: `HANGAR_INSTALL_DIR` (otra carpeta) y `HANGAR_NO_MODIFY_PATH=1` (no tocar el PATH).

## Usar

```bash
hangar init             # en la raíz del proyecto: detecta el tipo y crea hangar.json (va en el repo)
hangar login            # abre el navegador, eliges el proyecto y autorizas esta terminal
hangar build preview    # corre el comando del perfil y sube el archivo con versión, commit y notas
hangar upload app.apk --profile preview
hangar list
hangar share latest --profile preview --hours 24   # enlace + QR en la terminal
hangar open | hangar doctor | hangar whoami | hangar logout
hangar update --channel preview --message "Arreglo"  # actualización OTA (Expo)
hangar updates                                       # últimas actualizaciones OTA
```

### Actualizaciones OTA (Expo)

Mandan JavaScript y assets nuevos a las apps ya instaladas, sin compilar otro APK. Una vez, en `app.json`
(dentro de `"expo"`), y compilar un APK nuevo con `expo-updates` instalado:

```json
"runtimeVersion": { "policy": "appVersion" },
"updates": {
  "url": "https://hangar.fabrizziodev.com/ota/<proyecto>/manifest",
  "requestHeaders": { "expo-channel-name": "preview" }
}
```

Después, cada cambio de JS: `hangar update --channel preview`. Las apps de ese canal con el mismo runtime
(la versión de la app) lo bajan la próxima vez que abren. Si cambias código nativo, dependencias nativas o la
versión, compila otro APK. Revertir: desde el panel (sección Actualizaciones OTA del proyecto).

### hangar.json

```json
{
  "server": "https://hangar.fabrizziodev.com",
  "project": "preno",
  "profiles": {
    "preview": {
      "build": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 preview",
      "artifact": "dist-android/*-preview.apk"
    }
  }
}
```

- `build`: comando que compila (se corre desde la raíz con la shell del sistema).
- `artifact`: dónde queda el archivo; admite `*` y `**`. Si coinciden varios, se usa el más nuevo generado por esa
  compilación.
- `eas` (Expo): compila como ese perfil de `eas.json`. Toma sus variables `env` (siguiendo `extends`), no carga
  `.env` (EAS tampoco lo sube), no se detiene a preguntar por cambios sin commit y limpia el caché de Metro, donde
  quedan grabadas las variables `EXPO_PUBLIC_` del build anterior. `hangar init` lo pone en cada perfil.
- `env`: variables extra para el build; ganan sobre las de `eas`.

Un proyecto Expo con `eas.json` queda así:

```json
"demo": {
  "eas": "demo",
  "build": "npx expo prebuild --clean --platform android && cd android && gradlew.bat assembleRelease",
  "artifact": "android/app/build/outputs/apk/release/*.apk"
}
```

### Qué manda en cada subida

- Versión y código: de `app.json` (Expo), `pubspec.yaml`, Gradle, `pom.xml` o `package.json`. En un APK, el panel
  los completa leyendo el propio archivo.
- Commit y rama de git.
- Notas: los commits desde el último build de ese perfil en el panel (o `--notes "…"`).

### Llaves

`hangar login` guarda una llave por panel + proyecto en `%APPDATA%\hangar\config.json` (Windows) o
`~/.config/hangar/config.json`. Nunca en el repo. Orden en que se busca la llave:

1. `HANGAR_TOKEN` (y `HANGAR_URL`): para CI/CD.
2. La de `hangar login`.
3. `.hangar.env` en la raíz del proyecto (compatibilidad con scripts que ya lo usan).

### CI (GitHub Actions)

```yaml
- run: curl -fsSL https://hangar.fabrizziodev.com/install.sh | sh
- run: ~/.hangar/bin/hangar build release
  env:
    HANGAR_TOKEN: ${{ secrets.HANGAR_TOKEN }}
```

## Desarrollo

Requiere [Bun](https://bun.sh).

```bash
cd cli
bun install
bun run dev -- help          # correr sin compilar
bun test                     # pruebas
bun run typecheck
bun run scripts/build-binaries.ts windows-x64   # un ejecutable en dist/bin/
```

### Publicar una versión

1. Sube `VERSION` en `src/version.ts` y `package.json`.
2. En el panel crea (una vez) el proyecto **hangar-cli** y guarda su llave en `cli/.hangar.env`
   (`HANGAR_URL=…` y `HANGAR_TOKEN=…`; git lo ignora).
3. `bun run scripts/release.ts`: compila las 5 plataformas y las sube al proyecto `hangar-cli`, un perfil por
   plataforma. Los instaladores descargan siempre la más nueva.
