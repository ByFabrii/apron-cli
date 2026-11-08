// Busca archivos con un patrón simple: * (dentro de una carpeta) y ** (cualquier profundidad).
import { readdirSync, statSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

const SKIP = new Set(["node_modules", ".git", ".gradle", ".idea", ".dart_tool"]);

function toRegex(pattern: string): RegExp {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        re += pattern[i + 2] === "/" ? "(?:.*/)?" : ".*";
        i += pattern[i + 2] === "/" ? 2 : 1;
      } else {
        re += "[^/]*";
      }
    } else if (ch === "?") {
      re += "[^/]";
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, process.platform === "win32" ? "i" : "");
}

/** Archivos que coinciden, del más nuevo al más viejo. */
export function findFiles(root: string, pattern: string): { path: string; mtimeMs: number; size: number }[] {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "");
  if (isAbsolute(normalized)) {
    try {
      const st = statSync(normalized);
      return st.isFile() ? [{ path: normalized, mtimeMs: st.mtimeMs, size: st.size }] : [];
    } catch {
      return [];
    }
  }
  // Empieza a buscar en la parte fija del patrón (p. ej. "dist-android/" en "dist-android/*.apk").
  const fixed = normalized.split("/");
  const baseParts: string[] = [];
  for (const part of fixed.slice(0, -1)) {
    if (/[*?]/.test(part)) break;
    baseParts.push(part);
  }
  const base = join(root, ...baseParts);
  const regex = toRegex(normalized);
  const found: { path: string; mtimeMs: number; size: number }[] = [];
  const deep = normalized.includes("**");
  const maxDepth = deep ? 12 : fixed.length - baseParts.length;

  const walk = (dir: string, depth: number) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && depth < maxDepth) walk(full, depth + 1);
      } else if (entry.isFile()) {
        const rel = relative(root, full).split(sep).join("/");
        if (regex.test(rel)) {
          const st = statSync(full);
          found.push({ path: full, mtimeMs: st.mtimeMs, size: st.size });
        }
      }
    }
  };
  walk(base, 1);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}
