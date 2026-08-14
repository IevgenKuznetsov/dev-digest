"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "./_components/IntentCard";
import { BlastCard } from "./_components/BlastCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** PR uuid (row id), used to fetch intent from the API. */
  prId: string | null | undefined;
}

export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  return (
    <>
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
