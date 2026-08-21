/* MetricTrendChart — Recharts line chart showing recall/precision/citation over batches. */
"use client";

import React from "react";
import { LineChart } from "@devdigest/ui";

interface TrendPoint {
  ran_at: string;
  recall: number;
  precision: number;
  citation_accuracy: number;
}

export function MetricTrendChart({ points }: { points: TrendPoint[] }) {
  if (points.length === 0) {
    return (
      <div
        style={{
          height: 160,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--text-muted)",
          fontSize: 13,
          border: "1px dashed var(--border)",
          borderRadius: 9,
        }}
      >
        No batch runs yet — run evals to see trends.
      </div>
    );
  }

  const series = [
    { name: "Recall", color: "var(--accent)", data: points.map((p) => p.recall) },
    { name: "Precision", color: "var(--warn)", data: points.map((p) => p.precision) },
    { name: "Citation", color: "var(--ok)", data: points.map((p) => p.citation_accuracy) },
  ];

  return (
    <div>
      <div
        style={{
          display: "flex",
          gap: 16,
          marginBottom: 10,
          fontSize: 12,
          color: "var(--text-secondary)",
        }}
        aria-label="Chart legend"
      >
        {series.map((s) => (
          <span key={s.name} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 12,
                height: 3,
                borderRadius: 99,
                background: s.color,
                display: "inline-block",
              }}
              aria-hidden="true"
            />
            {s.name}
          </span>
        ))}
      </div>
      <LineChart series={series} h={160} yMin={0} yMax={1} />
    </div>
  );
}
