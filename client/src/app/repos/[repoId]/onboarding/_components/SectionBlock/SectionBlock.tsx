/**
 * SectionBlock — renders one onboarding section.
 *
 * - Shows a section heading from SECTION_TITLES[section.kind].
 * - Renders a Mermaid diagram for architecture sections (with fallback text if invalid).
 * - Renders section body as Markdown.
 * - For run_locally sections, code blocks get a copy button (via ReactMarkdown + custom components).
 * - For sections with links, renders a list with "Open on GitHub" buttons.
 */
"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Icon, Markdown } from "@devdigest/ui";
import { MermaidDiagram } from "@/components/mermaid-diagram";
import type { OnboardingSection } from "@devdigest/shared";
import { SECTION_TITLES } from "../OnboardingView/constants";
import { buildGitHubUrl, copyToClipboard } from "../OnboardingView/helpers";

interface SectionBlockProps {
  section: OnboardingSection;
  owner: string;
  repo: string;
  defaultBranch: string;
  onCopy: (text: string) => void;
}

/** Code block component with copy button — used in run_locally sections. */
function CopyableCodeBlock({
  children,
  onCopy,
}: {
  children?: React.ReactNode;
  onCopy: (text: string) => void;
}) {
  const text = typeof children === "string" ? children : "";
  return (
    <div style={{ position: "relative" }}>
      <pre
        style={{
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "12px 16px",
          overflowX: "auto",
          fontSize: 13,
          lineHeight: 1.5,
          margin: "0 0 10px",
        }}
      >
        <code>{children}</code>
      </pre>
      {text && (
        <button
          type="button"
          aria-label="Copy code to clipboard"
          onClick={() => onCopy(text)}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: "var(--bg-hover)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "2px 6px",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <Icon.Copy size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * Markdown renderer for run_locally sections — same styles as the vendor Markdown component
 * but with a custom code block that adds a copy button.
 */
function RunLocallyMarkdown({
  children,
  onCopy,
}: {
  children: string;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          // Fenced code blocks (pre > code).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          pre: ({ children }: any) => {
            // Extract the text content from the child <code> element.
            const codeEl = React.Children.toArray(children)[0] as React.ReactElement<{ children?: React.ReactNode }> | undefined;
            const codeText = codeEl?.props?.children;
            const text = typeof codeText === "string" ? codeText : "";
            return <CopyableCodeBlock onCopy={onCopy}>{text}</CopyableCodeBlock>;
          },
          // Inline code.
          code: ({ children }) => (
            <code
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "1px 6px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                color: "var(--accent-text)",
              }}
            >
              {children}
            </code>
          ),
          a: ({ children, href }) => (
            <a href={href} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function SectionBlock({
  section,
  owner,
  repo,
  defaultBranch,
  onCopy,
}: SectionBlockProps) {
  const title = SECTION_TITLES[section.kind] ?? section.title;
  const isArchitecture = section.kind === "architecture";
  const isRunLocally = section.kind === "run_locally";
  const [diagramFailed, setDiagramFailed] = React.useState(false);

  return (
    <section
      aria-label={title}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <h2
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--text-primary)",
          margin: 0,
          letterSpacing: "-0.01em",
        }}
      >
        {title}
      </h2>

      {/* Mermaid diagram — architecture section only (AC-U4) */}
      {isArchitecture && section.diagram && (
        <div>
          <MermaidDiagramWithFallback
            chart={section.diagram}
            onFailed={() => setDiagramFailed(true)}
          />
          {diagramFailed && (
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "8px 0 0" }}>
              Diagram could not be rendered.
            </p>
          )}
        </div>
      )}

      {/* Section body */}
      {isRunLocally ? (
        <RunLocallyMarkdown onCopy={onCopy}>{section.body}</RunLocallyMarkdown>
      ) : (
        <Markdown>{section.body}</Markdown>
      )}

      {/* Links list (critical_paths, reading_path) */}
      {section.links.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {section.links.map((link, i) => (
            <li key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Icon.File size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "var(--text-secondary)", flex: 1 }}>
                {link.label}
              </span>
              <a
                href={buildGitHubUrl(owner, repo, defaultBranch, link.path)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none" }}
              >
                <Button kind="secondary" size="sm" icon="ExternalLink">
                  Open
                </Button>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * MermaidDiagram wrapper that detects the "invalid" state and notifies the parent.
 * MermaidDiagram renders null on invalid — we use a timed check on the wrapper.
 */
function MermaidDiagramWithFallback({
  chart,
  onFailed,
}: {
  chart: string;
  onFailed: () => void;
}) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Give mermaid 3s to render before declaring failure.
    const timeout = setTimeout(() => {
      if (wrapperRef.current && wrapperRef.current.children.length === 0) {
        onFailed();
      }
    }, 3000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart]);

  return (
    <div ref={wrapperRef} aria-label="Architecture diagram">
      <MermaidDiagram chart={chart} />
    </div>
  );
}
