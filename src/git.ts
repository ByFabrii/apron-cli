// Datos de git del proyecto. Si no es un repo git, todo devuelve vacío.
import { spawnSync } from "node:child_process";

function git(root: string, args: string[]): { ok: boolean; out: string } {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

export function commit(root: string): string | undefined {
  const r = git(root, ["rev-parse", "HEAD"]);
  return r.ok && r.out ? r.out : undefined;
}

export function branch(root: string): string | undefined {
  const r = git(root, ["branch", "--show-current"]);
  return r.ok && r.out ? r.out : undefined;
}

export function isDirty(root: string): boolean {
  const r = git(root, ["status", "--porcelain", "--untracked-files=no"]);
  return r.ok && r.out.length > 0;
}

export function hasCommit(root: string, sha: string): boolean {
  return git(root, ["cat-file", "-t", sha]).out === "commit";
}

export function isAncestor(root: string, older: string, newer: string): boolean {
  return git(root, ["merge-base", "--is-ancestor", older, newer]).ok;
}

/** "- mensaje (abc1234)" por commit, sin merges. */
export function log(root: string, range: string[], max?: number): string[] {
  const args = ["log", "--no-merges", "--format=- %s (%h)", ...(max ? ["-n", String(max)] : []), ...range];
  const r = git(root, args);
  return r.ok && r.out ? r.out.split(/\r?\n/) : [];
}
