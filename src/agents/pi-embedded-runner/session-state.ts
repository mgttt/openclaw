import fs from "node:fs/promises";

export type SessionState = {
  task?: string;
  constraints?: string[];
  decisions?: string[];
  open_questions?: string[];
  artifacts?: string[];
  next_actions?: string[];
  updatedAt?: number;
};

export function resolveSessionStatePath(sessionFile: string): string {
  return `${sessionFile}.state.json`;
}

export async function loadSessionState(sessionFile: string): Promise<SessionState | null> {
  const path = resolveSessionStatePath(sessionFile);
  try {
    const raw = await fs.readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as SessionState;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveSessionState(sessionFile: string, state: SessionState): Promise<void> {
  const path = resolveSessionStatePath(sessionFile);
  const payload: SessionState = { ...state, updatedAt: Date.now() };
  await fs.writeFile(path, JSON.stringify(payload, null, 2), "utf-8");
}

export function formatSessionStateForPrompt(state: SessionState, maxChars = 1800): string {
  const lines: string[] = [];
  lines.push("# Session State (authoritative)");
  if (state.task) {
    lines.push(`- task: ${state.task}`);
  }
  const addList = (key: string, values?: string[]) => {
    if (!values || values.length === 0) {
      return;
    }
    lines.push(`- ${key}:`);
    for (const v of values.slice(0, 12)) {
      lines.push(`  - ${v}`);
    }
  };
  addList("constraints", state.constraints);
  addList("decisions", state.decisions);
  addList("open_questions", state.open_questions);
  addList("artifacts", state.artifacts);
  addList("next_actions", state.next_actions);
  const text = lines.join("\n");
  return text.length <= maxChars ? text : text.slice(0, maxChars - 20) + "\n…(truncated)";
}

/**
 * Best-effort state update based on compaction summary.
 * (No extra LLM call; safe for now.)
 */
export function deriveStateFromCompactionSummary(
  summary: string,
  previous?: SessionState | null,
): SessionState {
  const next: SessionState = previous ? { ...previous } : {};
  const cleaned = summary.trim();
  if (!cleaned) {
    return next;
  }

  // Heuristic: first non-empty line (strip bullets/heading markers) becomes task
  const firstLine = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (firstLine) {
    next.task = firstLine.replace(/^[-*#\s]+/, "").slice(0, 200);
  }

  // Extract list items as next actions (best-effort)
  const nextActions = cleaned
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^(-|\*|\d+\.)\s+/.test(l))
    .map((l) => l.replace(/^(-|\*|\d+\.)\s+/, ""))
    .filter((l) => l.length > 0)
    .slice(0, 12);
  if (nextActions.length > 0) {
    next.next_actions = Array.from(new Set([...(next.next_actions ?? []), ...nextActions])).slice(
      0,
      20,
    );
  }

  return next;
}
