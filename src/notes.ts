// Notas automáticas: los commits desde el último build de ese mismo perfil en el panel.
import type { Api } from "./api";
import * as git from "./git";

const MAX_COMMITS = 40;
const MAX_LENGTH = 4900;

export async function autoNotes(api: Api, root: string, profile: string | undefined, commit: string | undefined): Promise<string | undefined> {
  if (!commit) return undefined; // no es un repo git
  let previous: { commit?: string; version?: string } | undefined;
  try {
    previous = (await api.list(profile, 20)).find((b) => b.commit);
  } catch {
    previous = undefined; // sin el anterior, se mandan los últimos commits
  }
  const who = profile ?? "este proyecto";

  if (previous?.commit === commit) {
    return `Mismo commit que el build anterior de ${who}${previous.version ? ` (${previous.version})` : ""}: sin cambios de código.`;
  }

  let header: string;
  let lines: string[];
  if (previous?.commit && git.hasCommit(root, previous.commit) && git.isAncestor(root, previous.commit, commit)) {
    header = `Cambios desde ${previous.version ?? "el build anterior"} (${previous.commit.slice(0, 7)}):`;
    lines = git.log(root, [`${previous.commit}..${commit}`]);
  } else {
    header = previous
      ? `Últimos commits (el build anterior de ${who} no está en esta rama):`
      : `Últimos commits (primer build de ${who} en el panel):`;
    lines = git.log(root, [commit], 15);
  }
  if (lines.length === 0) return `${header}\n- Sin commits nuevos (solo merges).`;

  let text = `${header}\n${lines.slice(0, MAX_COMMITS).join("\n")}`;
  if (lines.length > MAX_COMMITS) text += `\n… y ${lines.length - MAX_COMMITS} commits más.`;
  return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH - 2)}\n…` : text;
}
