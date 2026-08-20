/** Shared constants for the eval case editor modal. */

export const FINDING_SKELETON_TEMPLATE = JSON.stringify(
  [
    {
      type: "must_find",
      file: "src/example.ts",
      start_line: 1,
      end_line: 10,
      severity: "WARNING",
      category: "security",
      title: "Example finding title",
    },
  ],
  null,
  2,
);

export const INPUT_TABS = ["Diff", "Files", "PR meta"] as const;
export type InputTab = (typeof INPUT_TABS)[number];
