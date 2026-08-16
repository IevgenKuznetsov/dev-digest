/** Build a GitHub file URL from its constituent parts. */
export function buildGitHubUrl(
  owner: string,
  repo: string,
  branch: string,
  path: string,
): string {
  return `https://github.com/${owner}/${repo}/blob/${branch}/${path}`;
}

/** Copy text to clipboard (noop if clipboard API unavailable). */
export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard?.writeText(text);
}
