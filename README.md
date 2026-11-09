# Hangar CLI

Compila y sube builds de cualquier proyecto (Expo/React Native, Flutter, Android, Java, Electron, Tauri, Node…) a tu
panel Hangar (autohospedado). Necesita Node 20 o más nuevo.

## Instalar

```bash
npm install -g @byfabrii/hangar      # o: pnpm add -g @byfabrii/hangar · bun add -g @byfabrii/hangar
hangar --version
```

El paquete es un solo archivo JavaScript: no tiene dependencias ni scripts de instalación, así que instalarlo no
ejecuta ni descarga nada más. Para actualizar, el mismo comando.

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
  "url": "https://hangar.tu-dominio.com/ota/<proyecto>/manifest",
  "requestHeaders": { "expo-channel-name": "preview" }
}
```

Después, cada cambio de JS: `hangar update --channel preview`. Las apps de ese canal con el mismo runtime
(la versión de la app) lo bajan la próxima vez que abren. Si cambias código nativo, dependencias nativas o la
versión, compila otro APK. Revertir: desde el panel (sección Actualizaciones OTA del proyecto).

### hangar.json

```json
{
  "server": "https://hangar.tu-dominio.com",
  "project": "mi-app",
  "profiles": {
    "preview": {
      "build": "cd android && ./gradlew assembleRelease",
      "artifact": "android/app/build/outputs/apk/release/*.apk"
    }
  }
}
```

- `build`: comando que compila (se corre desde la raíz con la shell del sistema). **`hangar build` ejecuta lo que
  diga aquí**, igual que `npm run`: no lo corras en repositorios de los que no te fíes.
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
- run: npm install -g @byfabrii/hangar@0.6.0     # versión fija: no cambia sola entre ejecuciones
- run: hangar build release
  env:
    HANGAR_URL: https://hangar.tu-dominio.com
    HANGAR_TOKEN: ${{ secrets.HANGAR_TOKEN }}
```

## Seguridad

- La llave de `hangar login` se guarda con permisos solo para tu usuario (`0600`) y nunca en el repo.
- Cada llave pertenece a un solo proyecto y se revoca desde el panel (Configuración y llaves).
- `hangar update` publica JavaScript que las apps instaladas ejecutan: trata esa llave como una de producción.

## Desarrollo

Requiere [Bun](https://bun.sh).

```bash
cd cli
bun install
bun run dev -- help          # correr sin compilar
bun test                     # pruebas
bun run typecheck
bun run build:js             # dist/hangar.js, el archivo que se publica
bun run check:pack           # qué llevaría el paquete de npm (y que no lleve secretos)
```

### Publicar una versión

1. Sube la versión en `src/version.ts` y `package.json`, y anota los cambios en el CHANGELOG del repo.
2. Commit, y un tag `cli-vX.Y.Z` con la misma versión: `git tag cli-v0.6.1 && git push origin main cli-v0.6.1`.
3. El workflow **Publicar CLI en npm** corre pruebas, compila, revisa el paquete (`check:pack`) y publica.

**Una sola vez** (para crear el paquete en npm), desde tu equipo con la cuenta `byfabrii` y su 2FA activo:
`cd cli && npm login && npm publish --access public`. Después, en npmjs.com → `@byfabrii/hangar` → Settings:
activa **Trusted publishing** para el repo `ByFabrii/hangar` y el workflow `cli-publish.yml`, y en *Publishing
access* elige "Require two-factor authentication and disallow tokens". Desde ahí solo GitHub Actions puede publicar.
