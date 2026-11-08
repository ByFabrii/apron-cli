// Salida en la terminal: colores (respetan NO_COLOR), pasos, errores y preguntas.
import { createInterface } from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";

const useColor = !process.env.NO_COLOR && (stdout.isTTY ?? false);
const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const c = {
  bold: paint("1"),
  dim: paint("2"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  magenta: paint("35"),
  cyan: paint("36"),
};

export function step(text: string) {
  stdout.write(`${c.cyan("›")} ${text}\n`);
}

export function ok(text: string) {
  stdout.write(`${c.green("✔")} ${text}\n`);
}

export function info(text: string) {
  stdout.write(`  ${c.dim(text)}\n`);
}

export function warn(text: string) {
  stderr.write(`${c.yellow("!")} ${text}\n`);
}

/** Error que se muestra al usuario tal cual y termina con código 1. */
export class CliError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
  }
}

export function fail(message: string, hint?: string): never {
  throw new CliError(message, hint);
}

export function interactive(): boolean {
  return Boolean(stdin.isTTY) && !process.env.CI;
}

export async function ask(question: string, fallback?: string): Promise<string> {
  if (!interactive()) {
    if (fallback !== undefined) return fallback;
    fail(`Falta un dato y la terminal no es interactiva: ${question}`);
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const suffix = fallback ? c.dim(` (${fallback})`) : "";
    const answer = (await rl.question(`${c.cyan("?")} ${question}${suffix} `)).trim();
    return answer || fallback || "";
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, fallback = true): Promise<boolean> {
  const answer = (await ask(`${question} ${fallback ? "[S/n]" : "[s/N]"}`, fallback ? "s" : "n")).toLowerCase();
  return answer.startsWith("s") || answer.startsWith("y");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

/** "hace 5 min", "hace 2 h"… */
export function relative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "hace un momento";
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86_400) return `hace ${Math.floor(seconds / 3600)} h`;
  const days = Math.floor(seconds / 86_400);
  return `hace ${days} ${days === 1 ? "día" : "días"}`;
}

/** Tabla simple alineada por columnas. */
export function table(rows: string[][]): string {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
  const widths: number[] = [];
  for (const row of rows) row.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, strip(cell).length)));
  return rows
    .map((row) => row.map((cell, i) => (i === row.length - 1 ? cell : cell + " ".repeat((widths[i] ?? 0) - strip(cell).length))).join("  "))
    .join("\n");
}
