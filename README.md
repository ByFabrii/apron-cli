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

### Actualizar

```bash
npm install -g @byfabrii/apron      # o: apron doctor, que dice si hay versión nueva
```

Una vez al día el CLI pregunta a npm cuál es la última versión y, si hay una más nueva, lo dice al final del comando.
Si el panel ya no acepta tu versión (cambió su API), el comando se detiene con el mismo mensaje y el comando para
actualizar.

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
"runtimeVersion": { "policy": "fingerprint" },
"updates": {
  "url": "https://apron.tu-dominio.com/ota/<proyecto>/manifest",
  "requestHeaders": { "expo-channel-name": "preview" }
}
```

Y un `fingerprint.config.js` para que la versión de la app no cuente como cambio nativo:

```js
module.exports = { sourceSkips: ["ExpoConfigVersions", "PackageJsonAndroidAndIosScriptsIfNotContainRun"], ignorePaths: ["eas.json"] };
```

Después, cada cambio de JS: `apron update --channel preview`. Le llega a todos los APK de ese canal con la misma
**parte nativa** (la huella), aunque la versión de la app haya subido. Revertir: desde el panel (sección
Actualizaciones OTA del proyecto).

**Si cambiaste algo nativo** (una dependencia con código nativo, un plugin, permisos, íconos), la huella cambia y los
APK instalados ya no son compatibles. `apron build` guarda la huella de cada APK en el panel y el panel cuenta los
dispositivos que preguntan por actualizaciones, así que `apron update` avisa antes de publicar:

```
! android: NINGUNO de los 3 dispositivo(s) del canal preview tiene un APK compatible con este código.
  Cambió en la parte nativa desde ese APK:
    • dependencia nativa expo-camera: nueva
  Qué hacer: compila e instala un APK nuevo en esos dispositivos (apron build preview) y comparte el enlace.
```

y no publica (pregunta en la terminal; en CI se detiene, salvo `--force`). Si todo está bien dice a cuántos
dispositivos les va a llegar.

El JavaScript se exporta con las variables del perfil que se llama como el canal (o el de `--profile`), igual que
`apron build`: las de `"env"` en `apron.json` y, con `"eas"`, las de ese perfil de `eas.json` sin leer `.env`. Si no
hay perfil con ese nombre, también se busca en `eas.json`. Así una actualización no sale con otras `EXPO_PUBLIC_…`
que el APK que la recibe.

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
- run: npm install -g @byfabrii/apron@0.9.0     # versión fija: no cambia sola entre ejecuciones
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
- Lo único que hace fuera de tu panel es la revisión diaria de versión: una petición pública a
  `registry.npmjs.org` que no lleva nada tuyo. No se hace en CI ni sin terminal; apágala con `APRON_NO_UPDATE_CHECK=1`.

## Desarrollo

Requiere [Bun](https://bun.sh).

```bash
bun install
bun run dev -- help          # correr sin compilar
bun test                     # pruebas
bun run typecheck
bun run build:js             # dist/apron.js, el archivo que se publica
bun run check:pack           # qué llevaría el paquete de npm (y que no lleve secretos)
```

### Publicar una versión

1. Sube la versión en `src/version.ts` y `package.json`.
2. Commit, y un tag `vX.Y.Z` con la misma versión: `git tag v0.9.0 && git push origin main v0.9.0`.
3. El workflow **Publicar en npm** corre pruebas, compila, revisa el paquete (`check:pack`) y publica con
   firma de origen.

**Una sola vez** (para crear el paquete), con 2FA activo en npm:
`bun install && bun run build:js && npm login && npm publish --access public`. Después,
en npmjs.com → `@byfabrii/apron` → Settings: activa **Trusted publishing** para `ByFabrii/apron-cli` y el workflow
`publish.yml`, y en *Publishing access* elige "Require two-factor authentication and disallow tokens".

## Licencia

[MIT](LICENSE)
