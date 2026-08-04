"use client";

import React from "react";
import { Button, EmptyState } from "@devdigest/ui";
import {
  useConventions,
  useExtractConventions,
  useUpdateConvention,
  useBatchUpdateConventions,
  useCreateConventionSkill,
} from "@/lib/hooks/conventions";
import { useActiveRepo } from "@/lib/repo-context";
import { ConventionCard } from "../ConventionCard";
import { CreateSkillModal } from "../CreateSkillModal";
import { s } from "./styles";

export function ConventionsView({ repoId }: { repoId: string }) {
  const { activeRepo } = useActiveRepo();
  const repoName = activeRepo?.full_name ?? "repo";
  const defaultBranch = activeRepo?.default_branch ?? "main";

  const { data: conventions, isLoading } = useConventions(repoId);
  const extract = useExtractConventions();
  const updateOne = useUpdateConvention();
  const batchUpdate = useBatchUpdateConventions();
  const createSkill = useCreateConventionSkill();

  const [showModal, setShowModal] = React.useState(false);

  const items = conventions ?? [];
  const acceptedCount = items.filter((c) => c.accepted).length;
  const isEmpty = items.length === 0 && !isLoading;

  const handleAccept = (id: string, accepted: boolean) => {
    updateOne.mutate({ id, accepted });
  };

  const handleDeselectAll = () => {
    const ids = items.map((c) => c.id);
    if (ids.length > 0) batchUpdate.mutate({ ids, accepted: false });
  };

  const handleExtract = () => {
    extract.mutate(repoId);
  };

  const handleCreateSkill = (name: string, description: string) => {
    createSkill.mutate(
      { repoId, name, description },
      { onSuccess: () => setShowModal(false) },
    );
  };

  // Empty state
  if (isEmpty && !extract.isPending) {
    return (
      <div style={s.root}>
        <EmptyState
          icon="ListChecks"
          title="No conventions extracted yet"
          body="Scan the repo to surface house-rules — naming, error handling, structure — each backed by evidence you can turn into a Skill."
          cta="Run extraction"
          onCta={handleExtract}
          ctaLoading={extract.isPending}
        />
      </div>
    );
  }

  return (
    <div style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.titleRow}>
          <h1 style={s.title}>
            Conventions in <span style={s.repoAccent}>{repoName}</span>
          </h1>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            onClick={handleExtract}
            loading={extract.isPending}
          >
            Re-scan
          </Button>
        </div>
        <div style={s.subtitle}>
          Detected from sample files
        </div>
      </div>

      {/* Toolbar */}
      <div style={s.toolbar}>
        <div style={s.toolbarLeft}>
          <button
            type="button"
            style={s.deselectBtn}
            onClick={handleDeselectAll}
            disabled={acceptedCount === 0}
          >
            ✕ Deselect all
          </button>
          <span style={s.acceptedCount}>
            {acceptedCount} of {items.length} accepted
          </span>
        </div>
        <Button
          kind="primary"
          size="sm"
          icon="Sparkles"
          onClick={() => setShowModal(true)}
          disabled={acceptedCount === 0}
        >
          Create skill
        </Button>
      </div>

      {/* Convention list */}
      <div style={s.list}>
        {items.map((c) => (
          <ConventionCard
            key={c.id}
            convention={c}
            repoFullName={repoName}
            defaultBranch={defaultBranch}
            onAccept={handleAccept}
            disabled={updateOne.isPending}
          />
        ))}
      </div>

      {/* Create skill modal */}
      {showModal && (
        <CreateSkillModal
          repoName={repoName}
          conventions={items.filter((c) => c.accepted)}
          onClose={() => setShowModal(false)}
          onSubmit={handleCreateSkill}
          loading={createSkill.isPending}
        />
      )}
    </div>
  );
}
