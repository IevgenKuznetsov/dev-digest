# React Frontend Architecture — Code Examples

Good/bad patterns for each rule in [SKILL.md](SKILL.md). Focused on WHERE code lives, not HOW to write it — see `react-best-practices/examples.md` for component patterns.

---

## 1. Component Location Decision

```
// BAD: Component only used by the PR detail page, placed in shared components/
components/
  FindingCard/
    FindingCard.tsx    ← only imported by app/repos/[repoId]/pulls/[number]/page.tsx

// GOOD: Page-specific component colocated with its route
app/repos/[repoId]/pulls/[number]/
  _components/
    FindingCard/
      FindingCard.tsx
      index.ts
      constants.ts
      helpers.ts
      styles.ts
```

```
// GOOD: Component used by 2+ pages promoted to shared
components/
  diff-viewer/
    DiffViewer.tsx     ← used by PR detail page AND commit detail page
    index.ts
    helpers.ts
    constants.ts
```

---

## 2. Constants Scope

```ts
// BAD: Component-specific constant dumped into a global file
// lib/constants.ts
export const KEY_TO_ACTION = { a: "accept", d: "dismiss" };  // only FindingsPanel uses this

// GOOD: Constant lives with its consumer
// app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/constants.ts
export const KEY_TO_ACTION = { a: "accept", d: "dismiss" };
```

```ts
// BAD: Shared constant buried in a component folder
// app/agents/_components/AgentCard/constants.ts
export const SUPPORTED_MODELS = ["gpt-4o", "claude-sonnet-4-20250514", "o1"];
// ← also needed by SettingsModels and AgentEditor

// GOOD: Truly shared constant in lib/
// lib/feature-models.ts
export const SUPPORTED_MODELS = ["gpt-4o", "claude-sonnet-4-20250514", "o1"];
```

---

## 3. Helper Extraction

```tsx
// BAD: Multi-step transform inline in the component body
function FindingsPanel({ findings }: Props) {
  const visible = findings
    .filter(f => !hideLow || f.confidence >= 0.7)
    .sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity])
    .map(f => ({ ...f, lineLabel: f.path ? `${f.path}:${f.line}` : "general" }));

  return <ul>{visible.map(f => <FindingRow key={f.id} finding={f} />)}</ul>;
}

// GOOD: Extracted to helpers.ts — testable in isolation
// FindingsPanel/helpers.ts
export function visibleFindings(
  findings: Finding[],
  hideLow: boolean,
): FindingView[] {
  return findings
    .filter(f => !hideLow || f.confidence >= 0.7)
    .sort((a, b) => SEV_ORDER[b.severity] - SEV_ORDER[a.severity])
    .map(f => ({ ...f, lineLabel: f.path ? `${f.path}:${f.line}` : "general" }));
}

// FindingsPanel/FindingsPanel.tsx
import { visibleFindings } from "./helpers";

function FindingsPanel({ findings }: Props) {
  const visible = useMemo(() => visibleFindings(findings, hideLow), [findings, hideLow]);
  return <ul>{visible.map(f => <FindingRow key={f.id} finding={f} />)}</ul>;
}
```

```tsx
// FINE INLINE: One-liner with no branching, not worth extracting
const displayName = `${repo.owner}/${repo.name}`;
```

---

## 4. Helper vs Hook

```tsx
// BAD: Pure function incorrectly written as a hook
function useModelColor(model: string): string {
  // No state, no effects, no context — this is a helper, not a hook
  return MODEL_COLOR[model] ?? "var(--text-secondary)";
}

// GOOD: Pure helper function
// AgentCard/helpers.ts
export function modelColor(model: string): string {
  return MODEL_COLOR[model] ?? "var(--text-secondary)";
}
```

```tsx
// GOOD: Correctly a hook — uses useEffect for side effects
// app-shell/hooks/useGlobalShortcuts.ts
export function useGlobalShortcuts(commands: Command[]) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) { /* ... */ }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commands]);
}
```

---

## 5. Business Logic in Hook vs Component

```tsx
// BAD: Component calls api.ts directly
import { api } from "@/lib/api";

function AgentList() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/agents").then(setAgents).finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    await api.delete(`/agents/${id}`);
    setAgents(prev => prev.filter(a => a.id !== id));
  };

  // ...
}

// GOOD: Component uses TanStack Query hooks
import { useAgents, useDeleteAgent } from "@/lib/hooks";

function AgentList() {
  const { data: agents, isLoading } = useAgents();
  const deleteAgent = useDeleteAgent();

  const handleDelete = (id: string) => deleteAgent.mutate(id);
  // ...
}
```

---

## 6. Dependency Direction Violation

```ts
// BAD: lib/ imports from app/ — reversed dependency
// lib/github-urls.ts
import { PR_BASE_PATH } from "@/app/repos/[repoId]/pulls/constants";
//                         ↑ lib/ must NEVER import from app/

export function prUrl(owner: string, repo: string, number: number) {
  return `${PR_BASE_PATH}/${owner}/${repo}/pull/${number}`;
}

// GOOD: lib/ is self-contained; app/ imports from lib/
// lib/github-urls.ts
const GITHUB_BASE = "https://github.com";

export function prUrl(owner: string, repo: string, number: number) {
  return `${GITHUB_BASE}/${owner}/${repo}/pull/${number}`;
}
```

```ts
// BAD: components/ imports from app/
// components/app-shell/AppShell.tsx
import { FilterBar } from "@/app/repos/[repoId]/pulls/_components/FilterBar";
//                        ↑ components/ must NEVER import from app/

// GOOD: If AppShell needs FilterBar, either:
// 1. Promote FilterBar to components/ (if truly shared)
// 2. Pass it as children from the page (composition)
```

---

## 7. Mutation Side-Effects Placement

```tsx
// BAD: Cache invalidation in the component
function AgentCard({ agent }: Props) {
  const qc = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/agents/${id}`),
  });

  const handleDelete = async () => {
    await deleteMutation.mutateAsync(agent.id);
    qc.invalidateQueries({ queryKey: ["agents"] });  // ← side-effect leaked to component
    notify.success("Agent deleted");                   // ← another leaked side-effect
  };
}

// GOOD: Side-effects encapsulated in the hook
// lib/hooks/agents.ts
export function useDeleteAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/agents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] });
      notify.success("Agent deleted");
    },
  });
}

// AgentCard.tsx — component only triggers the mutation
function AgentCard({ agent }: Props) {
  const deleteAgent = useDeleteAgent();
  const handleDelete = () => deleteAgent.mutate(agent.id);
}
```

---

## 8. Barrel Exports

```ts
// GOOD: Barrel at component boundary — hides internal structure
// components/diff-viewer/index.ts
export { DiffViewer } from "./DiffViewer";

// Consumer imports cleanly:
import { DiffViewer } from "@/components/diff-viewer";
```

```ts
// GOOD: Barrel at hook module boundary — single import point
// lib/hooks/index.ts
export { useSettings, useRepos, usePulls, usePullDetail } from "./core";
export { usePrReviews, useRunReview, useFindingAction } from "./reviews";
export { useAgents, useCreateAgent, useDeleteAgent } from "./agents";
export { useRunTrace } from "./trace";

// Consumer imports cleanly:
import { usePulls, useRunReview } from "@/lib/hooks";
```

```ts
// BAD: Deep re-export barrel that obscures source and hurts tree-shaking
// lib/index.ts
export * from "./hooks";
export * from "./api";
export * from "./types";
export * from "./github-urls";
export * from "./model-label";
export * from "./feature-models";
// ← Importing anything from "lib" pulls in everything; source is hidden
```
