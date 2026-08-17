"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { BlastCard } from "./_components/BlastCard";
import { PrBriefCard } from "./_components/PrBriefCard";
import { s } from "./styles";
import type { FindingRecord } from "@devdigest/shared";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** PR uuid (row id), used to fetch intent from the API. */
  prId: string | null | undefined;
  /** Current head SHA — used by PrBriefCard for stale detection. */
  headSha: string;
  /** All findings from the latest review — passed to PrBriefCard summary row. */
  allFindings: FindingRecord[];
}

export function OverviewTab({ prBody, prId, headSha, allFindings }: OverviewTabProps) {
  return (
    <>
      {/* PrBriefCard spans full width above the IntentCard/BlastCard row (AC-U1) */}
      {prId && (
        <PrBriefCard prId={prId} headSha={headSha} allFindings={allFindings} />
      )}

      {prId && (
        <div style={s.cardsRow}>
          <IntentCard prId={prId} />
          <BlastCard prId={prId} />
        </div>
      )}

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
