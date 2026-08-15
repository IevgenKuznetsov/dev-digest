/* ProjectContextView — two-panel layout for browsing, editing, and creating
   context documents. Left panel: file list + toolbar. Right panel: preview/edit. */
"use client";

import React from "react";
import { Button, Icon, Markdown } from "@devdigest/ui";
import {
  useContextDocs,
  useContextDocContent,
  useScanContextDocs,
  useUpdateContextDocContent,
  useCreateContextDoc,
  useDeleteContextDoc,
  useUploadContextDoc,
  useCreateContextFolder,
} from "@/lib/hooks/project-context";
import type { ContextDoc } from "@/lib/hooks/project-context";
import { EmptyState } from "../EmptyState";
import { CreateDocModal } from "../CreateDocModal";
import { UploadDocModal } from "../UploadDocModal";
import { CreateFolderModal } from "../CreateFolderModal";
import { s } from "./styles";

interface ProjectContextViewProps {
  repoId: string;
}

export function ProjectContextView({ repoId }: ProjectContextViewProps) {
  const [search, setSearch] = React.useState("");
  const [selectedDocId, setSelectedDocId] = React.useState<string | null>(null);
  const [mode, setMode] = React.useState<"preview" | "edit">("preview");
  const [editorContent, setEditorContent] = React.useState("");
  const [showCreateDoc, setShowCreateDoc] = React.useState(false);
  const [showUpload, setShowUpload] = React.useState(false);
  const [showCreateFolder, setShowCreateFolder] = React.useState(false);

  const { data: docs, isLoading } = useContextDocs(repoId, search || undefined);
  const { data: docContent } = useContextDocContent(repoId, selectedDocId);

  const scan = useScanContextDocs(repoId);
  const updateContent = useUpdateContextDocContent(repoId, selectedDocId);
  const createDoc = useCreateContextDoc(repoId);
  const deleteDoc = useDeleteContextDoc(repoId);
  const uploadDoc = useUploadContextDoc(repoId);
  const createFolder = useCreateContextFolder(repoId);

  // Sync editor content with fetched content when doc changes or mode switches to edit
  React.useEffect(() => {
    if (mode === "edit" && docContent !== undefined) {
      setEditorContent(docContent);
    }
  }, [docContent, mode]);

  // Reset editor state when selected doc changes
  React.useEffect(() => {
    setMode("preview");
    setEditorContent("");
  }, [selectedDocId]);

  const selectedDoc = docs?.find((d) => d.id === selectedDocId) ?? null;
  const isDirty = mode === "edit" && editorContent !== (docContent ?? "");
  const isEmpty = !isLoading && (!docs || docs.length === 0);

  // Auto-select first doc when list loads with no selection
  React.useEffect(() => {
    if (docs && docs.length > 0 && !selectedDocId) {
      setSelectedDocId(docs[0]!.id);
    }
  }, [docs, selectedDocId]);

  const handleSave = () => {
    updateContent.mutate(editorContent, {
      onSuccess: () => {
        setMode("preview");
      },
    });
  };

  const handleCreateDoc = (directory: "specs" | "docs" | "insights", filename: string) => {
    createDoc.mutate(
      { directory, filename },
      {
        onSuccess: (doc) => {
          setShowCreateDoc(false);
          setSelectedDocId(doc.id);
          setMode("edit");
        },
      },
    );
  };

  const handleUpload = (formData: FormData) => {
    uploadDoc.mutate(formData, {
      onSuccess: (doc) => {
        setShowUpload(false);
        setSelectedDocId(doc.id);
      },
    });
  };

  const handleCreateFolder = (directory: "specs" | "docs" | "insights", name: string) => {
    createFolder.mutate(
      { directory, name },
      { onSuccess: () => setShowCreateFolder(false) },
    );
  };

  const formatRelativeTime = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  const lastScanned = docs && docs.length > 0
    ? docs.reduce((latest: ContextDoc, d: ContextDoc) => new Date(d.scannedAt) > new Date(latest.scannedAt) ? d : latest, docs[0]!)
    : null;

  if (isEmpty) {
    return (
      <div style={{ display: "flex", flex: 1, height: "calc(100vh - 52px)" }}>
        <EmptyState onAdd={() => setShowCreateDoc(true)} />
        {showCreateDoc && (
          <CreateDocModal
            onClose={() => setShowCreateDoc(false)}
            onSubmit={handleCreateDoc}
            loading={createDoc.isPending}
          />
        )}
      </div>
    );
  }

  return (
    <div style={s.root}>
      {/* ---- Left panel ---- */}
      <div style={s.leftPanel}>
        <div style={s.leftHeader}>
          <div style={s.leftTitle}>Project Context</div>
          <div style={s.toolbar}>
            <button
              style={s.toolBtn}
              title="New file"
              onClick={() => setShowCreateDoc(true)}
              type="button"
            >
              <Icon.Plus size={15} />
            </button>
            <button
              style={s.toolBtn}
              title="New folder"
              onClick={() => setShowCreateFolder(true)}
              type="button"
            >
              <Icon.Folder size={15} />
            </button>
            <button
              style={s.toolBtn}
              title="Upload file"
              onClick={() => setShowUpload(true)}
              type="button"
            >
              <Icon.ArrowUp size={15} />
            </button>
            <button
              style={s.toolBtn}
              title="Refresh / re-scan"
              onClick={() => scan.mutate()}
              type="button"
            >
              <Icon.RefreshCw size={15} style={scan.isPending ? { animation: "spin 1s linear infinite" } : {}} />
            </button>
          </div>
        </div>

        <input
          style={s.searchInput}
          placeholder="Filter files…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Filter context files"
        />

        <div style={s.fileList} role="list">
          {(docs ?? []).map((doc) => (
            <div
              key={doc.id}
              style={s.fileItem(doc.id === selectedDocId)}
              onClick={() => setSelectedDocId(doc.id)}
              role="listitem"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && setSelectedDocId(doc.id)}
              aria-selected={doc.id === selectedDocId}
            >
              <Icon.FileText size={13} style={{ flexShrink: 0 }} />
              <span style={s.fileName} title={doc.path}>
                {doc.path.split("/").pop()}
              </span>
              <span style={s.fileCategory}>{doc.category}</span>
            </div>
          ))}
        </div>

        <div style={s.footer}>
          <div style={s.dot} />
          <span>
            Indexed: {docs?.length ?? 0} files
            {lastScanned ? ` · ${formatRelativeTime(lastScanned.scannedAt)}` : ""}
          </span>
          {scan.isPending && <span style={{ marginLeft: "auto" }}>Scanning…</span>}
        </div>
      </div>

      {/* ---- Right panel ---- */}
      <div style={s.rightPanel}>
        {selectedDoc ? (
          <>
            <div style={s.rightHeader}>
              <Icon.FileText size={14} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span style={s.rightFilename} title={selectedDoc.path}>
                {selectedDoc.path}
              </span>
              {isDirty && <div style={s.dirtyDot} title="Unsaved changes" />}
              <button
                style={s.toggleBtn(mode === "preview")}
                onClick={() => setMode("preview")}
                type="button"
              >
                Preview
              </button>
              <button
                style={s.toggleBtn(mode === "edit")}
                onClick={() => setMode("edit")}
                type="button"
              >
                Edit
              </button>
              <button
                style={{ ...s.toolBtn, color: "var(--danger, var(--text-muted))" }}
                title="Delete file"
                type="button"
                onClick={() => {
                  if (confirm(`Delete ${selectedDoc.path}?`)) {
                    deleteDoc.mutate(selectedDoc.id, {
                      onSuccess: () => setSelectedDocId(null),
                    });
                  }
                }}
              >
                <Icon.X size={14} />
              </button>
            </div>

            <div style={s.rightBody}>
              {mode === "preview" ? (
                docContent != null ? (
                  <Markdown>{docContent}</Markdown>
                ) : (
                  <span style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading…</span>
                )
              ) : (
                <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                  <textarea
                    style={s.textarea}
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    aria-label="Edit context document"
                    autoFocus
                  />
                  <div style={s.saveRow}>
                    {isDirty && (
                      <span style={s.unsavedNote}>Unsaved changes</span>
                    )}
                    <Button
                      kind="primary"
                      size="sm"
                      onClick={handleSave}
                      loading={updateContent.isPending}
                      disabled={!isDirty}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={s.placeholder}>
            Select a file to preview or edit
          </div>
        )}
      </div>

      {/* ---- Modals ---- */}
      {showCreateDoc && (
        <CreateDocModal
          onClose={() => setShowCreateDoc(false)}
          onSubmit={handleCreateDoc}
          loading={createDoc.isPending}
        />
      )}
      {showUpload && (
        <UploadDocModal
          onClose={() => setShowUpload(false)}
          onSubmit={handleUpload}
          loading={uploadDoc.isPending}
        />
      )}
      {showCreateFolder && (
        <CreateFolderModal
          onClose={() => setShowCreateFolder(false)}
          onSubmit={handleCreateFolder}
          loading={createFolder.isPending}
        />
      )}
    </div>
  );
}
