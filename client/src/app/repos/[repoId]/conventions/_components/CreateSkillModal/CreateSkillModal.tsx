"use client";

import React from "react";
import { Modal, FormField, TextInput, Button, Toggle } from "@devdigest/ui";
import type { ConventionCandidate } from "@devdigest/shared";
import { s } from "./styles";

interface CreateSkillModalProps {
  repoName: string;
  conventions: ConventionCandidate[];
  onClose: () => void;
  onSubmit: (name: string, description: string) => void;
  loading?: boolean;
}

/** Build a markdown skill body from accepted conventions, grouped by category. */
function buildSkillBody(repoName: string, conventions: ConventionCandidate[]): string {
  const groups = new Map<string, Array<{ rule: string; path: string; snippet: string }>>();

  for (const c of conventions) {
    const match = c.rule.match(/^\[([^\]]+)\]\s*(.*)/s);
    const category = match ? match[1]! : "General";
    const ruleText = match ? match[2]! : c.rule;

    let group = groups.get(category);
    if (!group) {
      group = [];
      groups.set(category, group);
    }
    group.push({ rule: ruleText, path: c.evidence_path, snippet: c.evidence_snippet });
  }

  const lines: string[] = [
    `# ${repoName}-conventions`,
    "",
    `House conventions for '${repoName}'. Flag changes that violate any rule below and cite the offending 'file:line'.`,
    "",
  ];

  for (const [category, rules] of groups) {
    lines.push(`## ${category}`);
    for (const r of rules) {
      lines.push(`- ${r.rule}`);
      if (r.path) lines.push(`  Detected in '${r.path}':`);
      if (r.snippet) {
        lines.push("  ```");
        lines.push(`  ${r.snippet}`);
        lines.push("  ```");
      }
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function CreateSkillModal({
  repoName,
  conventions,
  onClose,
  onSubmit,
  loading,
}: CreateSkillModalProps) {
  const defaultName = `${repoName}-conventions`;
  const defaultDesc = `${conventions.length} house conventions extracted from ${repoName}`;

  const [name, setName] = React.useState(defaultName);
  const [description, setDescription] = React.useState(defaultDesc);
  const [enabled, setEnabled] = React.useState(true);

  const body = React.useMemo(() => buildSkillBody(repoName, conventions), [repoName, conventions]);

  const canSubmit = name.trim().length > 0 && !loading;

  return (
    <Modal
      width={720}
      title="Create skill from conventions"
      subtitle={defaultName}
      onClose={onClose}
      footer={
        <div style={s.footer}>
          <Button kind="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            kind="primary"
            icon="Sparkles"
            onClick={() => onSubmit(name.trim(), description)}
            disabled={!canSubmit}
            loading={loading}
          >
            Create skill
          </Button>
        </div>
      }
    >
      <div style={s.info}>
        <span>
          Merged from{" "}
          <span style={s.infoAccent}>{conventions.length} accepted conventions</span> in{" "}
          <span style={s.infoAccent}>{repoName}</span>. Everything below is editable before
          you save.
        </span>
      </div>

      <div style={s.fieldGroup}>
        <FormField label="Name" required>
          <TextInput value={name} onChange={setName} placeholder="Skill name" />
        </FormField>

        <FormField label="Description">
          <TextInput value={description} onChange={setDescription} placeholder="Description" />
        </FormField>

        <div style={s.row}>
          <FormField label="Type">
            <TextInput value="convention" onChange={() => {}} />
          </FormField>
          <FormField label="Enabled" hint="Whether this block is added to agents' prompts.">
            <Toggle on={enabled} onChange={setEnabled} />
          </FormField>
        </div>
      </div>

      <div>
        <div style={s.bodyLabel}>Skill body *</div>
        <div style={s.bodyFilename}>{name || "skill"}.md</div>
        <div style={s.bodyPreview}>{body}</div>
      </div>
    </Modal>
  );
}
