/* AgentCheckboxList — renders the list of agents with checkboxes for multi-agent run config. */
"use client";

import React from "react";
import type { Agent } from "@devdigest/shared";

const s = {
  list: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px solid var(--border-subtle)",
    backgroundColor: "var(--surface-2)",
    cursor: "pointer",
    transition: "border-color 0.15s",
  },
  rowChecked: {
    borderColor: "var(--accent)",
  },
  rowDisabled: {
    opacity: 0.5,
    cursor: "not-allowed",
  },
  checkbox: {
    width: 16,
    height: 16,
    cursor: "pointer",
    accentColor: "var(--accent)",
    flexShrink: 0,
  },
  agentInfo: {
    flex: 1,
    minWidth: 0,
  },
  agentName: {
    fontSize: 14,
    fontWeight: 500,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  badge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 2,
  },
  statusBadge: (enabled: boolean) => ({
    fontSize: 10,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 4,
    backgroundColor: enabled ? "var(--success-subtle)" : "var(--surface-3)",
    color: enabled ? "var(--success)" : "var(--text-muted)",
    letterSpacing: "0.03em",
  }),
};

interface AgentCheckboxListProps {
  agents: Agent[];
  selectedIds: Set<string>;
  onChange: (id: string, checked: boolean) => void;
}

export function AgentCheckboxList({ agents, selectedIds, onChange }: AgentCheckboxListProps) {
  if (agents.length === 0) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
        No agents configured. Add agents in the Agents section.
      </p>
    );
  }

  return (
    <ul style={s.list} role="list" aria-label="Agent selection list">
      {agents.map((agent) => {
        const checked = selectedIds.has(agent.id);
        return (
          <li
            key={agent.id}
            style={{
              ...s.row,
              ...(checked ? s.rowChecked : {}),
            }}
            onClick={() => onChange(agent.id, !checked)}
          >
            <input
              id={`agent-checkbox-${agent.id}`}
              type="checkbox"
              style={s.checkbox}
              checked={checked}
              onChange={(e) => onChange(agent.id, e.target.checked)}
              aria-label={`Select agent ${agent.name}`}
              onClick={(e) => e.stopPropagation()}
            />
            <div style={s.agentInfo}>
              <label
                htmlFor={`agent-checkbox-${agent.id}`}
                style={{ ...s.agentName, cursor: "pointer" }}
                onClick={(e) => e.stopPropagation()}
              >
                {agent.name}
              </label>
              <div style={s.badge}>
                {agent.provider && <span>{agent.provider}</span>}
                {agent.provider && agent.model && <span>·</span>}
                {agent.model && <span style={{ fontFamily: "monospace" }}>{agent.model}</span>}
              </div>
            </div>
            <span style={s.statusBadge(agent.enabled)}>
              {agent.enabled ? "ENABLED" : "DISABLED"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
