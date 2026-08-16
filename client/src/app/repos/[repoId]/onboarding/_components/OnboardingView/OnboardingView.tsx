/**
 * OnboardingView — main onboarding tour component.
 *
 * Three UI states:
 *   1. Generating (mutation pending OR query returns { status: 'generating' }) — shows spinner.
 *      During regeneration, old content is HIDDEN (edge case 9).
 *   2. Empty (no tour, no mutation) — shows EmptyState CTA.
 *   3. Tour rendered — shows header with Regenerate + Share, then 5 SectionBlock components.
 */
"use client";

import React from "react";
import { Button, EmptyState, Icon } from "@devdigest/ui";
import { useOnboarding, useGenerateOnboarding } from "@/lib/hooks/onboarding";
import { useActiveRepo } from "@/lib/repo-context";
import { useToast } from "@/lib/toast";
import { SectionBlock } from "../SectionBlock";
import { s } from "./styles";
import { copyToClipboard } from "./helpers";
import type { OnboardingResponse } from "@devdigest/shared";

interface OnboardingViewProps {
  repoId: string;
}

export function OnboardingView({ repoId }: OnboardingViewProps) {
  const { activeRepo } = useActiveRepo();
  const { data, isLoading } = useOnboarding(repoId);
  const generate = useGenerateOnboarding();
  const toast = useToast();

  const owner = activeRepo?.owner ?? "";
  const repoName = activeRepo?.name ?? "";
  const defaultBranch = activeRepo?.default_branch ?? "main";

  const isGenerating =
    generate.isPending ||
    (data != null && "status" in data && data.status === "generating");

  const tour = data != null && !("status" in data) ? (data as OnboardingResponse) : null;
  const isEmpty = !isLoading && !isGenerating && tour === null;

  const handleGenerate = () => {
    generate.mutate({ repoId });
  };

  const handleShare = async () => {
    await copyToClipboard(window.location.href);
    toast.success("Link copied.");
  };

  const handleCopyCode = async (text: string) => {
    await copyToClipboard(text);
    toast.success("Copied to clipboard.");
  };

  // State 1: Generating (mutation pending or query says 'generating').
  // Edge case 9: do NOT show old tour content during regeneration.
  if (isGenerating) {
    return (
      <main style={s.generatingRoot} aria-live="polite">
        <Icon.RefreshCw size={28} style={{ animation: "ddspin 1s linear infinite" }} />
        <p style={s.generatingText}>Generating&hellip;</p>
      </main>
    );
  }

  // State 2: Empty state — no tour exists yet.
  if (isEmpty) {
    return (
      <main>
        <EmptyState
          icon="Sparkles"
          title="Generate onboarding tour"
          body="DevDigest indexes the repo, then writes a 5-section guided tour: architecture overview, critical paths, how to run locally, guided reading path, and first tasks."
          cta="Generate onboarding tour"
          onCta={handleGenerate}
          ctaLoading={generate.isPending}
        />
      </main>
    );
  }

  // State 3: Tour rendered.
  if (!tour) return null;

  return (
    <main style={s.root}>
      {/* Header */}
      <div style={s.header}>
        <h1 style={s.title}>Onboarding Tour</h1>
        <div style={s.headerActions}>
          <Button
            kind="secondary"
            size="sm"
            icon="Link"
            onClick={() => void handleShare()}
            aria-label="Share — copy link to clipboard"
          >
            Share
          </Button>
          <Button
            kind="secondary"
            size="sm"
            icon="RefreshCw"
            onClick={handleGenerate}
            loading={generate.isPending}
            aria-label="Regenerate onboarding tour"
          >
            Regenerate
          </Button>
        </div>
      </div>

      {/* Sections */}
      <div style={s.sections}>
        {tour.sections.map((section) => (
          <SectionBlock
            key={section.kind}
            section={section}
            owner={owner}
            repo={repoName}
            defaultBranch={defaultBranch}
            onCopy={(text) => void handleCopyCode(text)}
          />
        ))}
      </div>
    </main>
  );
}
