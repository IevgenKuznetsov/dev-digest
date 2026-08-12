"use client";

import React, { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { BlastCallerApi, BlastChangedSymbolApi } from "@devdigest/shared";
import { useBlastRadius } from "@/lib/hooks/reviews";

// ---- Constants -------------------------------------------------------

const KIND_BADGE: Record<string, { color: string; bg: string }> = {
  function: { color: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  class: { color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  type: { color: "#34d399", bg: "rgba(52,211,153,0.12)" },
  variable: { color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
};

const METHOD_BADGE: Record<string, { color: string; bg: string }> = {
  GET: { color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  POST: { color: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  PUT: { color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  PATCH: { color: "#f97316", bg: "rgba(249,115,22,0.12)" },
  DELETE: { color: "#f87171", bg: "rgba(248,113,113,0.12)" },
};

const MAX_CALLERS_DISPLAY = 20;

function pluralize(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ---- Styles ----------------------------------------------------------

const s = {
  card: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 14,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  title: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
  },
  countersRow: {
    display: "flex",
    gap: 12,
    fontSize: 12,
    color: "var(--text-muted)",
  },
  counterItem: {
    display: "flex",
    alignItems: "center",
    gap: 4,
  },
  counterBadge: {
    fontSize: 10,
    fontWeight: 700,
    color: "var(--text-muted)",
    background: "var(--bg-hover)",
    borderRadius: 8,
    padding: "1px 6px",
    minWidth: 18,
    textAlign: "center" as const,
  },
  treeRoot: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
  },
  treeNode: {
    display: "flex",
    flexDirection: "column" as const,
  },
  treeToggle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "pointer",
    padding: "3px 4px",
    borderRadius: 4,
    border: "none",
    background: "none",
    width: "100%",
    textAlign: "left" as const,
  },
  chevron: (open: boolean) => ({
    fontSize: 10,
    color: "var(--text-muted)",
    transition: "transform 0.15s",
    transform: open ? "rotate(90deg)" : "rotate(0deg)",
    flexShrink: 0,
    width: 12,
    textAlign: "center" as const,
  }),
  kindBadge: (kind: string) => {
    const b = KIND_BADGE[kind.toLowerCase()] ?? {
      color: "var(--text-muted)",
      bg: "var(--bg-hover)",
    };
    return {
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: "0.05em",
      padding: "1px 5px",
      borderRadius: 3,
      color: b.color,
      background: b.bg,
      textTransform: "uppercase" as const,
      flexShrink: 0,
    };
  },
  methodBadge: (method: string) => {
    const b = METHOD_BADGE[method.toUpperCase()] ?? {
      color: "var(--text-muted)",
      bg: "var(--bg-hover)",
    };
    return {
      fontSize: 10,
      fontWeight: 700,
      padding: "1px 5px",
      borderRadius: 3,
      color: b.color,
      background: b.bg,
      flexShrink: 0,
    };
  },
  symbolName: {
    fontWeight: 500,
    color: "var(--text-primary)",
  },
  callerLabel: {
    fontSize: 12,
    color: "var(--text-muted)",
    marginLeft: "auto",
    flexShrink: 0,
  },
  childList: {
    listStyle: "none",
    padding: "2px 0 2px 20px",
    margin: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 1,
    borderLeft: "1px solid var(--border)",
    marginLeft: 6,
  },
  callerLink: {
    fontSize: 12,
    color: "var(--accent, #3b82f6)",
    cursor: "pointer",
    textDecoration: "none",
    padding: "2px 4px",
    borderRadius: 3,
    display: "block",
    lineHeight: 1.5,
  },
  endpointList: {
    listStyle: "none",
    padding: 0,
    margin: 0,
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
  endpointItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 13,
    color: "var(--text-secondary)",
  },
  banner: {
    fontSize: 12,
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    borderRadius: 4,
    padding: "6px 10px",
    border: "1px solid var(--border)",
  },
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
  loading: {
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  },
};

// ---- Sub-components --------------------------------------------------

/** Symbol tree node — expanded by default, only rendered if it has callers. */
function SymbolNode({
  symbol,
  callers,
  onFileClick,
}: {
  symbol: BlastChangedSymbolApi;
  callers: BlastCallerApi[];
  onFileClick: (file: string, line: number) => void;
}) {
  const [open, setOpen] = useState(true);
  const sorted = [...callers]
    .sort((a, b) => b.rank - a.rank)
    .slice(0, MAX_CALLERS_DISPLAY);

  return (
    <li style={s.treeNode}>
      <button
        type="button"
        style={s.treeToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span style={s.chevron(open)}>▶</span>
        <span style={s.kindBadge(symbol.kind)}>{symbol.kind}</span>
        <span style={s.symbolName}>{symbol.name}</span>
        <span style={s.callerLabel}>{pluralize(sorted.length, "caller")}</span>
      </button>

      {open && (
        <ul style={s.childList}>
          {sorted.map((c, i) => (
            <li key={i}>
              <a
                style={s.callerLink}
                onClick={(e) => {
                  e.preventDefault();
                  onFileClick(c.file, c.line);
                }}
                href="#"
                title={`${c.file}:${c.line}`}
              >
                {c.file}:{c.line}
              </a>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function EndpointsList({ endpoints }: { endpoints: string[] }) {
  if (endpoints.length === 0) {
    return <span style={s.empty}>No HTTP endpoints affected</span>;
  }
  return (
    <ul style={s.endpointList}>
      {endpoints.map((ep, i) => {
        const parts = ep.split(" ");
        const method = parts[0] ?? "";
        const path = parts.slice(1).join(" ");
        return (
          <li key={i} style={s.endpointItem}>
            <span style={s.methodBadge(method)}>{method}</span>
            <span>{path}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Main component --------------------------------------------------

interface BlastCardProps {
  prId: string;
}

export function BlastCard({ prId }: BlastCardProps) {
  const { data, isLoading, isError } = useBlastRadius(prId);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleFileClick(file: string, line: number) {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", "diff");
    params.set("file", file);
    if (line > 0) params.set("line", String(line));
    router.push(`${pathname}?${params.toString()}`);
  }

  if (isError) return null;

  if (isLoading) {
    return (
      <div style={s.card}>
        <div style={s.header}>
          <span style={s.title}>Blast Radius</span>
        </div>
        <div style={s.loading}>Loading blast radius…</div>
      </div>
    );
  }

  if (!data) return null;

  const showNoFiles = data.reason === "no_files";

  // Build lookup: symbol name → callers (excluding declaration files)
  const declarationFiles = new Set(data.changed_symbols.map((sym) => sym.file));
  const callersBySymbol = new Map<string, BlastCallerApi[]>();
  let totalCallers = 0;
  for (const caller of data.callers) {
    if (declarationFiles.has(caller.file)) continue;
    const key = caller.via_symbol;
    const group = callersBySymbol.get(key) ?? [];
    group.push(caller);
    callersBySymbol.set(key, group);
    totalCallers++;
  }

  // Only show symbols that have callers
  const symbolsWithCallers = data.changed_symbols.filter(
    (sym) => (callersBySymbol.get(sym.name)?.length ?? 0) > 0,
  );

  return (
    <div style={s.card}>
      {/* Header */}
      <div style={s.header}>
        <span style={s.title}>Blast Radius</span>
      </div>

      {/* Degraded / no-files banners */}
      {showNoFiles && (
        <div style={s.banner}>
          PR files not loaded yet — open the Files tab first
        </div>
      )}
      {!showNoFiles && data.degraded && (
        <div style={s.banner}>
          Index incomplete — results may be approximate
        </div>
      )}

      {/* Summary counters */}
      <div style={s.countersRow}>
        <span style={s.counterItem}>
          <span style={s.counterBadge}>{symbolsWithCallers.length}</span>
          {pluralize(symbolsWithCallers.length, "symbol")}
        </span>
        <span style={s.counterItem}>
          <span style={s.counterBadge}>{totalCallers}</span>
          {pluralize(totalCallers, "caller")}
        </span>
        <span style={s.counterItem}>
          <span style={s.counterBadge}>{data.impacted_endpoints.length}</span>
          {pluralize(data.impacted_endpoints.length, "endpoint")}
        </span>
      </div>

      {/* Symbol tree — only symbols with callers, expanded by default */}
      {symbolsWithCallers.length === 0 ? (
        <span style={s.empty}>No affected callers detected</span>
      ) : (
        <ul style={s.treeRoot}>
          {symbolsWithCallers.map((sym, i) => (
            <SymbolNode
              key={i}
              symbol={sym}
              callers={callersBySymbol.get(sym.name) ?? []}
              onFileClick={handleFileClick}
            />
          ))}
        </ul>
      )}

      {/* Impacted Endpoints */}
      {data.impacted_endpoints.length > 0 && (
        <EndpointsList endpoints={data.impacted_endpoints} />
      )}
    </div>
  );
}
