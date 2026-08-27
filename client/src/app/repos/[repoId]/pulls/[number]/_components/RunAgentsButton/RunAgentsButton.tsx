/* RunAgentsButton — launches a coordinated multi-agent review for THIS PR.
   Opens a popover with an agent checklist (enabled agents pre-selected), then
   POSTs /pulls/:prId/multi-agent-run and navigates to the results page. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@devdigest/ui";
import { AgentCheckboxList } from "@/components/agent-checkbox-list";
import { useAgents } from "@/lib/hooks/agents";
import { useCreateMultiAgentRun } from "@/lib/hooks/multi-agent-review";
import { s } from "./styles";

export function RunAgentsButton({
  prId,
  size = "sm",
}: {
  prId: string;
  size?: "sm" | "md" | "lg";
}) {
  const router = useRouter();
  const { data: agents } = useAgents();
  const createRun = useCreateMultiAgentRun();

  const [open, setOpen] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const rootRef = React.useRef<HTMLDivElement>(null);

  // Default-select enabled agents once they load.
  const seededRef = React.useRef(false);
  React.useEffect(() => {
    if (agents && !seededRef.current) {
      seededRef.current = true;
      setSelectedIds(new Set(agents.filter((a) => a.enabled).map((a) => a.id)));
    }
  }, [agents]);

  // Close on outside click (matches the Dropdown primitive's behavior).
  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleChange = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const canRun = selectedIds.size > 0 && !createRun.isPending;

  const handleRun = () => {
    if (!canRun) return;
    createRun.mutate(
      { prId, agent_ids: [...selectedIds] },
      {
        onSuccess: (result) => {
          setOpen(false);
          router.push(`/multi-agent-review/${result.id}`);
        },
      },
    );
  };

  return (
    <div ref={rootRef} style={s.root}>
      <Button
        kind="primary"
        size={size}
        icon="Users"
        iconRight="ChevronDown"
        onClick={() => setOpen((o) => !o)}
      >
        Run Agents
      </Button>

      {open && (
        <div style={s.panel} role="dialog" aria-label="Run multi-agent review">
          <div style={s.header}>
            <span style={s.title}>Agents</span>
            <span style={s.count}>{selectedIds.size} selected</span>
          </div>

          <div style={s.list}>
            <AgentCheckboxList
              agents={agents ?? []}
              selectedIds={selectedIds}
              onChange={handleChange}
            />
          </div>

          {createRun.error && (
            <div style={s.error} role="alert">
              {(createRun.error as { message?: string })?.message ?? "Failed to start run."}
            </div>
          )}

          <Button
            kind="primary"
            size="sm"
            icon="Sparkles"
            full
            disabled={!canRun}
            loading={createRun.isPending}
            onClick={handleRun}
          >
            {createRun.isPending ? "Starting…" : "Run Selected Agents"}
          </Button>

          {selectedIds.size === 0 && (
            <p style={s.hint}>Select at least one agent to run.</p>
          )}
        </div>
      )}
    </div>
  );
}
