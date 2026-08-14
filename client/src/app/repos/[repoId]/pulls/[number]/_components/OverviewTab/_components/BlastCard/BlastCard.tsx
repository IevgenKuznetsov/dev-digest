"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { BlastCallerApi, BlastChangedSymbolApi } from "@devdigest/shared";
import type { BlastRadiusResponse } from "@devdigest/shared";
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

type ViewMode = "tree" | "graph";

// ---- Shared styles ---------------------------------------------------

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
    justifyContent: "space-between",
  },
  headerLeft: {
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
  headerSummary: {
    fontSize: 11,
    color: "var(--text-muted)",
  },
  countersRow: {
    display: "flex",
    alignItems: "center",
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
  toggle: {
    display: "flex",
    border: "1px solid var(--border)",
    borderRadius: 6,
    overflow: "hidden",
    flexShrink: 0,
  },
  toggleBtn: (active: boolean) => ({
    fontSize: 11,
    fontWeight: active ? 600 : 400,
    padding: "3px 10px",
    border: "none",
    cursor: "pointer",
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    background: active ? "var(--bg-hover)" : "transparent",
  }),
  // Tree styles
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
  // Graph styles
  graphContainer: {
    position: "relative" as const,
    overflow: "auto",
  },
  graphColumns: {
    display: "grid",
    gridTemplateColumns: "auto 1fr auto",
    gap: 0,
    alignItems: "start",
    position: "relative" as const,
    padding: "16px 0",
  },
  graphColumn: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    zIndex: 1,
  },
  graphColumnEven: {
    display: "flex",
    flexDirection: "column" as const,
    justifyContent: "space-around",
    alignItems: "center",
    zIndex: 1,
    height: "100%",
  },
  graphNode: (color: string, bg: string) => ({
    fontSize: 12,
    fontWeight: 500,
    padding: "6px 12px",
    borderRadius: 6,
    border: `1px solid ${color}`,
    background: bg,
    color: "var(--text-primary)",
    whiteSpace: "nowrap" as const,
    position: "relative" as const,
  }),
  graphLegend: {
    display: "flex",
    gap: 16,
    fontSize: 11,
    color: "var(--text-muted)",
    paddingTop: 4,
  },
  legendDot: (color: string) => ({
    display: "inline-block",
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: color,
    marginRight: 4,
    verticalAlign: "middle",
  }),
};

// ---- Prepared data ----------------------------------------------------

interface BlastData {
  symbolsWithCallers: BlastChangedSymbolApi[];
  callersBySymbol: Map<string, BlastCallerApi[]>;
  totalCallers: number;
  endpointCount: number;
  cronCount: number;
}

function prepareBlastData(data: BlastRadiusResponse): BlastData {
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
  const symbolsWithCallers = data.changed_symbols.filter(
    (sym) => (callersBySymbol.get(sym.name)?.length ?? 0) > 0,
  );

  let cronCount = 0;
  if (data.facts_by_file) {
    for (const f of Object.values(data.facts_by_file)) {
      cronCount += f.crons.length;
    }
  }

  return {
    symbolsWithCallers,
    callersBySymbol,
    totalCallers,
    endpointCount: data.impacted_endpoints.length,
    cronCount,
  };
}

// ---- Tree view --------------------------------------------------------

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

function TreeView({
  bd,
  endpoints,
  onFileClick,
}: {
  bd: BlastData;
  endpoints: string[];
  onFileClick: (file: string, line: number) => void;
}) {
  return (
    <>
      {bd.symbolsWithCallers.length === 0 ? (
        <span style={s.empty}>No affected callers detected</span>
      ) : (
        <ul style={s.treeRoot}>
          {bd.symbolsWithCallers.map((sym, i) => (
            <SymbolNode
              key={`${sym.file}:${sym.name}`}
              symbol={sym}
              callers={bd.callersBySymbol.get(sym.name) ?? []}
              onFileClick={onFileClick}
            />
          ))}
        </ul>
      )}
      {endpoints.length > 0 && (
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
      )}
    </>
  );
}

// ---- Graph view -------------------------------------------------------

/** Derive short module name from file path: `src/routes/auth.ts` → `auth` */
function moduleNameFromPath(filePath: string): string {
  const parts = filePath.split("/");
  const last = parts[parts.length - 1] ?? filePath;
  return last.replace(/\.(ts|tsx|js|jsx|mjs)$/, "");
}

interface GraphEdge {
  fromId: string;
  toId: string;
}

/**
 * Per-symbol dependency graphs: each symbol gets its own row showing
 * symbol → callers → endpoints. Groups don't overlap.
 */
function SymbolGraph({
  symbol,
  callers,
  factsByFile,
  allEndpoints,
  groupIdx,
  containerRef,
  nodeRefs,
  setNodeRef,
}: {
  symbol: BlastChangedSymbolApi;
  callers: BlastCallerApi[];
  factsByFile?: Record<string, { endpoints: string[]; crons: string[] }>;
  /** All impacted_endpoints for the PR — used as fallback when factsByFile has no match. */
  allEndpoints: string[];
  groupIdx: number;
  containerRef: React.RefObject<HTMLDivElement | null>;
  nodeRefs: React.RefObject<Map<string, HTMLDivElement>>;
  setNodeRef: (id: string, el: HTMLDivElement | null) => void;
}) {
  const [lines, setLines] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([]);
  const groupRef = useRef<HTMLDivElement>(null);

  // Deduplicate callers by file
  const callerFiles: { file: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const c of callers) {
    if (!seen.has(c.file)) {
      seen.add(c.file);
      callerFiles.push({ file: c.file, label: moduleNameFromPath(c.file) });
    }
  }

  // Collect endpoints reachable from this symbol's callers via factsByFile
  const endpointSet = new Set<string>();
  const hasFactsAttribution = factsByFile && Object.keys(factsByFile).length > 0;
  if (hasFactsAttribution) {
    for (const cf of callerFiles) {
      const facts = factsByFile[cf.file];
      if (facts) {
        for (const ep of facts.endpoints) endpointSet.add(ep);
      }
    }
  }
  const endpoints = [...endpointSet];
  // No per-file attribution but endpoints exist — show degraded placeholder
  const showDegraded = endpointSet.size === 0 && allEndpoints.length > 0;

  // Build edges for this group
  const edges: GraphEdge[] = [];
  const prefix = `g${groupIdx}`;
  for (const cf of callerFiles) {
    edges.push({ fromId: `${prefix}-sym`, toId: `${prefix}-cal-${cf.file}` });
  }
  if (hasFactsAttribution) {
    for (const cf of callerFiles) {
      const facts = factsByFile[cf.file];
      if (facts) {
        for (const ep of facts.endpoints) {
          edges.push({ fromId: `${prefix}-cal-${cf.file}`, toId: `${prefix}-ep-${ep}` });
        }
      }
    }
  }
  if (showDegraded) {
    edges.push({ fromId: `${prefix}-sym`, toId: `${prefix}-degraded` });
  }

  useEffect(() => {
    function computeLines() {
      const group = groupRef.current;
      if (!group) return;
      const rect = group.getBoundingClientRect();
      const computed: typeof lines = [];
      for (const edge of edges) {
        const from = nodeRefs.current.get(edge.fromId);
        const to = nodeRefs.current.get(edge.toId);
        if (!from || !to) continue;
        const fr = from.getBoundingClientRect();
        const tr = to.getBoundingClientRect();
        computed.push({
          x1: fr.right - rect.left,
          y1: fr.top + fr.height / 2 - rect.top,
          x2: tr.left - rect.left,
          y2: tr.top + tr.height / 2 - rect.top,
        });
      }
      setLines(computed);
    }

    computeLines();
    const timer = setTimeout(computeLines, 50);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callers, factsByFile]);

  const symColor = "var(--text-muted)";
  const symBg = "var(--bg-hover)";
  const calColor = "var(--border)";
  const calBg = "transparent";
  const epColor = "#3b82f6";
  const epBg = "rgba(59,130,246,0.08)";

  const maxNodes = Math.max(1, callerFiles.length, endpoints.length);
  const minHeight = maxNodes * 36 + 12;

  return (
    <div ref={groupRef} style={{ position: "relative" }}>
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        {lines.map((l, i) => (
          <line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}
      </svg>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr auto",
          gap: 0,
          alignItems: "start",
          position: "relative",
          minHeight,
        }}
      >
        {/* Symbol */}
        <div style={s.graphColumnEven}>
          <div
            ref={(el) => setNodeRef(`${prefix}-sym`, el)}
            style={s.graphNode(symColor, symBg)}
          >
            {symbol.name}
            {symbol.kind === "function" ? "()" : ""}
          </div>
        </div>

        {/* Callers */}
        <div style={s.graphColumnEven}>
          {callerFiles.map((cf) => (
            <div
              key={cf.file}
              ref={(el) => setNodeRef(`${prefix}-cal-${cf.file}`, el)}
              style={s.graphNode(calColor, calBg)}
              title={cf.file}
            >
              {cf.label}
            </div>
          ))}
        </div>

        {/* Endpoints or degraded placeholder */}
        <div style={s.graphColumnEven}>
          {showDegraded && (
            <div
              ref={(el) => setNodeRef(`${prefix}-degraded`, el)}
              style={s.graphNode("#f59e0b", "rgba(245,158,11,0.08)")}
            >
              DEGRADED — need indexing
            </div>
          )}
          {endpoints.map((ep) => {
            const parts = ep.split(" ");
            const method = parts[0] ?? "";
            const path = parts.slice(1).join(" ");
            return (
              <div
                key={ep}
                ref={(el) => setNodeRef(`${prefix}-ep-${ep}`, el)}
                style={s.graphNode(epColor, epBg)}
              >
                <span style={{ fontWeight: 600, marginRight: 4 }}>{method}</span>
                {path}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GraphView({
  bd,
  data,
}: {
  bd: BlastData;
  data: BlastRadiusResponse;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const setNodeRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) nodeRefs.current.set(id, el);
    else nodeRefs.current.delete(id);
  }, []);

  const symColor = "var(--text-muted)";
  const epColor = "#3b82f6";

  return (
    <div ref={containerRef} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {bd.symbolsWithCallers.map((sym, idx) => (
        <SymbolGraph
          key={`${sym.file}:${sym.name}`}
          symbol={sym}
          callers={bd.callersBySymbol.get(sym.name) ?? []}
          factsByFile={data.facts_by_file}
          allEndpoints={data.impacted_endpoints}
          groupIdx={idx}
          containerRef={containerRef}
          nodeRefs={nodeRefs}
          setNodeRef={setNodeRef}
        />
      ))}

      {bd.symbolsWithCallers.length === 0 && (
        <span style={s.empty}>No affected callers detected</span>
      )}

      {/* Legend */}
      <div style={s.graphLegend}>
        <span>
          <span style={s.legendDot(symColor)} />
          changed symbol
        </span>
        <span>
          <span style={s.legendDot("var(--text-secondary)")} />
          callers
        </span>
        <span>
          <span style={s.legendDot(epColor)} />
          endpoints affected
        </span>
      </div>
    </div>
  );
}

// ---- Main component --------------------------------------------------

interface BlastCardProps {
  prId: string;
}

export function BlastCard({ prId }: BlastCardProps) {
  const { data, isLoading, isError } = useBlastRadius(prId);
  const [view, setView] = useState<ViewMode>("tree");
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
          <div style={s.headerLeft}>
            <span style={s.title}>Blast Radius</span>
          </div>
        </div>
        <div style={s.loading}>Loading blast radius…</div>
      </div>
    );
  }

  if (!data) return null;

  const showNoFiles = data.reason === "no_files";
  const bd = prepareBlastData(data);

  return (
    <div style={s.card}>
      {/* Header with summary + toggle */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.title}>Blast Radius</span>
          <span style={s.headerSummary}>
            {pluralize(bd.totalCallers, "caller")} · {pluralize(bd.endpointCount, "endpoint")}
          </span>
        </div>
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

      {/* Counters row + view toggle */}
      <div style={{ ...s.countersRow, justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 12 }}>
          <span style={s.counterItem}>
            <span style={s.counterBadge}>{bd.symbolsWithCallers.length}</span>
            {pluralize(bd.symbolsWithCallers.length, "symbol")}
          </span>
          <span style={s.counterItem}>
            <span style={s.counterBadge}>{bd.totalCallers}</span>
            {pluralize(bd.totalCallers, "caller")}
          </span>
          <span style={s.counterItem}>
            <span style={s.counterBadge}>{bd.endpointCount}</span>
            {pluralize(bd.endpointCount, "endpoint")}
          </span>
          {bd.cronCount > 0 && (
            <span style={s.counterItem}>
              <span style={s.counterBadge}>{bd.cronCount}</span>
              {pluralize(bd.cronCount, "cron")}
            </span>
          )}
        </div>
        <div style={s.toggle}>
          <button
            type="button"
            style={s.toggleBtn(view === "tree")}
            onClick={() => setView("tree")}
          >
            Tree
          </button>
          <button
            type="button"
            style={s.toggleBtn(view === "graph")}
            onClick={() => setView("graph")}
          >
            Graph
          </button>
        </div>
      </div>

      {/* View content */}
      {view === "tree" ? (
        <TreeView
          bd={bd}
          endpoints={data.impacted_endpoints}
          onFileClick={handleFileClick}
        />
      ) : (
        <GraphView bd={bd} data={data} />
      )}
    </div>
  );
}
