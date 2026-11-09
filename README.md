<p align="center"><img src="docs/logo.svg" width="88" alt="Apron"></p>

# Apron CLI

Compila, sube y comparte los builds de tus apps desde tu terminal hacia **tu propio panel Apron**: APK, AAB, IPA,
instaladores, y actualizaciones OTA para apps de Expo. Funciona con Expo/React Native, Flutter, Android, Java,
Electron, Tauri y Node.

> **¿Por qué "Apron"?** En un aeropuerto, el *apron* (la plataforma) es donde se estacionan, cargan y despachan los
> aviones listos para salir. Apron hace eso con tus builds: los guarda listos y los despacha a quien los necesita.

## Instalar

Necesita Node 20 o más nuevo y un panel Apron (autohospedado).

```bash
npm install -g @byfabrii/apron      # o: pnpm add -g @byfabrii/apron · bun add -g @byfabrii/apron
apron --version
```

El paquete se llama `@byfabrii/apron` (npm no permite `apron` a secas por parecerse a `cron`); el comando es `apron`.
El paquete es un solo archivo JavaScript, **sin dependencias ni scripts de instalación**: instalarlo no ejecuta ni
descarga nada más. Cada versión se publica desde GitHub Actions con
[firma de origen](https://docs.npmjs.com/generating-provenance-statements) (provenance): en npm puedes comprobar de
qué commit de este repositorio salió.

## Usar

```bash
apron init             # en la raíz del proyecto: detecta el tipo y crea apron.json (va en el repo)
apron login            # abre el navegador, eliges el proyecto y autorizas esta terminal
apron build preview    # corre el comando del perfil y sube el archivo con versión, commit y notas
apron upload app.apk --profile preview
apron list
apron share latest --profile preview --hours 24   # enlace + QR en la terminal
apron open | apron doctor | apron whoami | apron logout
apron update --channel preview --message "Arreglo"  # actualización OTA (Expo)
apron updates                                       # últimas actualizaciones OTA
```

### Actualizaciones OTA (Expo)

Mandan JavaScript y assets nuevos a las apps ya instaladas, sin compilar otro APK. Una vez, en `app.json`
(dentro de `"expo"`), y compilar un APK nuevo con `expo-updates` instalado:

```json
"runtimeVersion": { "policy": "appVersion" },
"updates": {
  "url": "https://apron.tu-dominio.com/ota/<proyecto>/manifest",
  "requestHeaders": { "expo-channel-name": "preview" }
}
```

Después, cada cambio de JS: `apron update --channel preview`. Las apps de ese canal con el mismo runtime
(la versión de la app) lo bajan la próxima vez que abren. Si cambias código nativo, dependencias nativas o la
versión, compila otro APK. Revertir: desde el panel (sección Actualizaciones OTA del proyecto).

### apron.json

```json
{
  "server": "https://apron.tu-dominio.com",
  "project": "mi-app",
  "profiles": {
    "preview": {
      "build": "cd android && ./gradlew assembleRelease",
      "artifact": "android/app/build/outputs/apk/release/*.apk"
    }
  }
}
```

- `build`: comando que compila (se corre desde la raíz con la shell del sistema). **`apron build` ejecuta lo que
  diga aquí**, igual que `npm run`: no lo corras en repositorios de los que no te fíes.
- `artifact`: dónde queda el archivo; admite `*` y `**`. Si coinciden varios, se usa el más nuevo generado por esa
  compilación.
- `eas` (Expo): compila como ese perfil de `eas.json`. Toma sus variables `env` (siguiendo `extends`), no carga
  `.env` (EAS tampoco lo sube), no se detiene a preguntar por cambios sin commit y limpia el caché de Metro, donde
  quedan grabadas las variables `EXPO_PUBLIC_` del build anterior. `apron init` lo pone en cada perfil.
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

`apron login` guarda una llave por panel + proyecto en `%APPDATA%\apron\config.json` (Windows) o
`~/.config/apron/config.json`. Nunca en el repo. Orden en que se busca la llave:

1. `APRON_TOKEN` (y `APRON_URL`): para CI/CD.
2. La de `apron login`.
3. `.apron.env` en la raíz del proyecto (`APRON_URL=…` y `APRON_TOKEN=…`). Agrégalo a tu `.gitignore`.

### CI (GitHub Actions)

```yaml
- run: npm install -g @byfabrii/apron@0.7.0     # versión fija: no cambia sola entre ejecuciones
- run: apron build release
  env:
    APRON_URL: https://apron.tu-dominio.com
    APRON_TOKEN: ${{ secrets.APRON_TOKEN }}
```

## Si venías de Hangar

Apron se llamaba Hangar. Todo lo anterior sigue funcionando sin tocar nada: `hangar.json`, `.hangar.env`, las
variables `HANGAR_TOKEN` / `HANGAR_URL` y las llaves guardadas por `hangar login`. Si existen `apron.json` y
`hangar.json`, manda `apron.json`. Para pasarte: renombra los archivos cuando quieras.

## Seguridad

- La llave de `apron login` se guarda con permisos solo para tu usuario (`0600`) y nunca en el repo.
- Cada llave pertenece a un solo proyecto y se revoca desde el panel (Configuración y llaves).
- `apron update` publica JavaScript que las apps instaladas ejecutan: trata esa llave como una de producción.

## Desarrollo

Requiere [Bun](https://bun.sh).

```bash
cd cli
bun install
bun run dev -- help          # correr sin compilar
bun test                     # pruebas
bun run typecheck
bun run build:js             # dist/apron.js, el archivo que se publica
bun run check:pack           # qué llevaría el paquete de npm (y que no lleve secretos)
```

### Publicar una versión

1. Sube la versión en `src/version.ts` y `package.json`.
2. Commit, y un tag `vX.Y.Z` con la misma versión: `git tag v0.7.1 && git push origin main v0.7.1`.
3. El workflow **Publicar en npm** corre pruebas, compila, revisa el paquete (`check:pack`) y publica con
   firma de origen.

**Una sola vez** (para crear el paquete), con 2FA activo en npm:
`bun install && bun run build:js && npm login && npm publish --access public`. Después,
en npmjs.com → `@byfabrii/apron` → Settings: activa **Trusted publishing** para `ByFabrii/apron-cli` y el workflow
`publish.yml`, y en *Publishing access* elige "Require two-factor authentication and disallow tokens".

## Licencia

[MIT](LICENSE)
