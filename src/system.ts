// Abrir el navegador, nombre del equipo y QR en la terminal.
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import QRCode from "qrcode";

export function openUrl(url: string): boolean {
  try {
    const [cmd, args] =
      process.platform === "win32" ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin" ? ["open", [url]]
      : ["xdg-open", [url]];
    const child = spawn(cmd, args as string[], { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function machineName(): string {
  return hostname() || "Terminal";
}

/** QR con medios bloques: cabe en una terminal normal y se escanea bien. */
export async function terminalQr(text: string): Promise<string> {
  return QRCode.toString(text, { type: "terminal", small: true, errorCorrectionLevel: "M" });
}
