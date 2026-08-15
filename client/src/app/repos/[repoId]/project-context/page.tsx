/* /repos/[repoId]/project-context — Project Context page entry point.
   Thin route — all logic lives in ProjectContextView. */
"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useRepoNotFound } from "@/lib/repo-context";
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ProjectContextPage() {
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const notFound = useRepoNotFound(repoId);

  if (notFound) return <RepoNotFound />;

  return (
    <AppShell crumb={[{ label: "Workspace" }, { label: "Project Context" }]}>
      <ProjectContextView repoId={repoId} />
    </AppShell>
  );
}
