/* FilterBar — query param filter controls for the CI Runs page. */
"use client";

import React from "react";
import type { CiRunsFilters } from "../../../../lib/hooks/ci";

export interface FilterBarProps {
  filters: CiRunsFilters;
  onChange: (next: CiRunsFilters) => void;
}

export function FilterBar({ filters, onChange }: FilterBarProps) {
  function set(key: keyof CiRunsFilters, value: string) {
    onChange({ ...filters, [key]: value || null });
  }

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        flexWrap: "wrap",
        alignItems: "center",
        padding: "0 0 18px",
      }}
    >
      <input
        type="text"
        aria-label="Filter by repository"
        placeholder="Repository"
        value={filters.repo ?? ""}
        onChange={(e) => set("repo", e.target.value)}
        style={inputStyle}
      />
      <input
        type="text"
        aria-label="Filter by agent"
        placeholder="Agent"
        value={filters.agent ?? ""}
        onChange={(e) => set("agent", e.target.value)}
        style={inputStyle}
      />
      <input
        type="text"
        aria-label="Filter by source"
        placeholder="Source"
        value={filters.source ?? ""}
        onChange={(e) => set("source", e.target.value)}
        style={inputStyle}
      />
      <select
        aria-label="Filter by status"
        value={filters.status ?? ""}
        onChange={(e) => set("status", e.target.value)}
        style={{ ...inputStyle, width: 150 }}
      >
        <option value="">All statuses</option>
        <option value="succeeded">Succeeded</option>
        <option value="failed">Failed</option>
        <option value="no_findings">No Findings</option>
        <option value="running">Running</option>
      </select>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "7px 12px",
  borderRadius: 7,
  border: "1px solid var(--border-strong)",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  fontSize: 13,
  width: 180,
};
