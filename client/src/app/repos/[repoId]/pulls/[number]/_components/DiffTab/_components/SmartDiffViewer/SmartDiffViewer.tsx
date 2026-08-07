"use client";

import React from "react";
import { Badge, SectionLabel, Icon, type IconName } from "@devdigest/ui";
import { FileCard } from "@/components/diff-viewer/FileCard";
import type { DiffCommentApi } from "@/components/diff-viewer";
import type { LineFinding } from "@/components/diff-viewer/CodeLine";
import type { SmartDiffGroup, FindingRecord } from "@devdigest/shared";
import type { PrFile } from "@devdigest/shared";
import { ROLE_ORDER, ROLE_LABELS, ROLE_ICONS, DEFAULT_COLLAPSED, FILE_DEFAULT_EXPANDED } from "./constants";
import { s } from "./styles";

interface SmartDiffViewerProps {
  groups: SmartDiffGroup[];
  files: PrFile[];
  commenting?: DiffCommentApi;
  /** All findings from the latest review — used to annotate lines with severity. */
  findings?: FindingRecord[];
}

export function SmartDiffViewer({ groups, files, commenting, findings }: SmartDiffViewerProps) {
  const [collapsed, setCollapsed] = React.useState(DEFAULT_COLLAPSED);
  const fileRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());

  // Build a fast lookup: path → PrFile (which has the patch)
  const fileByPath = React.useMemo(() => {
    const map = new Map<string, PrFile>();
    for (const f of files) map.set(f.path, f);
    return map;
  }, [files]);

  // Build per-file, per-line finding lookup: file → Map<lineNo, LineFinding>
  const findingsByFile = React.useMemo(() => {
    const map = new Map<string, Map<number, LineFinding>>();
    if (!findings?.length) return map;
    for (const f of findings) {
      if (!map.has(f.file)) map.set(f.file, new Map());
      const lineMap = map.get(f.file)!;
      // Use start_line as the anchor; if multiple findings on same line, highest severity wins
      const existing = lineMap.get(f.start_line);
      const sevRank: Record<string, number> = { CRITICAL: 0, WARNING: 1, SUGGESTION: 2 };
      if (!existing || (sevRank[f.severity] ?? 9) < (sevRank[existing.severity] ?? 9)) {
        lineMap.set(f.start_line, { severity: f.severity as LineFinding["severity"], title: f.title });
      }
    }
    return map;
  }, [findings]);

  // Build per-file full FindingRecord[] lookup for tooltips
  const findingRecordsByFile = React.useMemo(() => {
    const map = new Map<string, FindingRecord[]>();
    if (!findings?.length) return map;
    for (const f of findings) {
      if (!map.has(f.file)) map.set(f.file, []);
      map.get(f.file)!.push(f);
    }
    return map;
  }, [findings]);

  // Render groups in ROLE_ORDER, skip groups not present in the data
  const groupMap = React.useMemo(() => {
    const m = new Map<string, SmartDiffGroup>();
    for (const g of groups) m.set(g.role, g);
    return m;
  }, [groups]);

  const scrollToFile = (path: string) => {
    const el = fileRefs.current.get(path);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const groupElements = ROLE_ORDER.map((role) => {
    const group = groupMap.get(role);
    if (!group) return null;

    const filesWithFindings = group.files.filter((f) => f.finding_lines.length > 0);
    if (filesWithFindings.length === 0) return null;

    const isCollapsed = collapsed[role];
    const totalFindings = filesWithFindings.reduce((sum, f) => sum + f.finding_lines.length, 0);

    return (
      <div key={role} style={s.group}>
        <SectionLabel
          icon={ROLE_ICONS[role] as IconName}
          right={
            <div style={s.badges}>
              <Badge>{filesWithFindings.length} files</Badge>
              {totalFindings > 0 && (
                <Badge bg="var(--warn-bg)" color="var(--warn)">
                  {totalFindings} findings
                </Badge>
              )}
              <div
                role="button"
                style={s.collapseToggle}
                aria-expanded={!isCollapsed}
                onClick={() => setCollapsed((prev) => ({ ...prev, [role]: !prev[role] }))}
              >
                {isCollapsed ? <Icon.ChevronRight size={14} /> : <Icon.ChevronDown size={14} />}
              </div>
            </div>
          }
        >
          <span
            role="button"
            style={{ cursor: "pointer" }}
            onClick={() => setCollapsed((prev) => ({ ...prev, [role]: !prev[role] }))}
          >
            {ROLE_LABELS[role]}
          </span>
        </SectionLabel>

        {!isCollapsed && (
          <div style={s.groupBody}>
            {filesWithFindings.map((smartFile) => {
              const prFile = fileByPath.get(smartFile.path);
              if (!prFile) return null;
              const findingCount = smartFile.finding_lines.length;
              return (
                <div
                  key={smartFile.path}
                  ref={(el) => {
                    if (el) fileRefs.current.set(smartFile.path, el);
                    else fileRefs.current.delete(smartFile.path);
                  }}
                >
                  <FileCard
                    file={prFile}
                    commenting={commenting}
                    defaultExpanded={FILE_DEFAULT_EXPANDED[role]}
                    findingLines={smartFile.finding_lines}
                    findingsMap={findingsByFile.get(smartFile.path)}
                    fileFindings={findingRecordsByFile.get(smartFile.path)}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  });

  const hasAnyGroups = groupElements.some((el) => el !== null);

  return (
    <div>
      {hasAnyGroups ? (
        groupElements
      ) : (
        <div
          style={{
            color: "var(--text-muted)",
            textAlign: "center",
            padding: 40,
          }}
        >
          No findings yet. Run a review or switch to Flat view to see all files.
        </div>
      )}
    </div>
  );
}
