/* /repos/[repoId]/onboarding — Onboarding Tour page entry point.
   Thin route — all logic lives in OnboardingView. */
"use client";

import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { useRepoNotFound } from "@/lib/repo-context";
import { OnboardingView } from "./_components/OnboardingView";

export default function OnboardingPage() {
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const notFound = useRepoNotFound(repoId);

  if (notFound) return <RepoNotFound />;

  return (
    <AppShell crumb={[{ label: "Onboarding Tour" }]}>
      <OnboardingView repoId={repoId} />
    </AppShell>
  );
}
