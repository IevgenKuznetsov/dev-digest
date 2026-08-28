/* patch-nav.ts — injects local nav items into the vendor NAV array.
   Imported as a side-effect before AppShell renders, so the Sidebar
   picks up the extra items without editing vendor code. */
import { NAV } from "@devdigest/ui";

const EVAL_ITEM = {
  key: "eval",
  label: "Eval Dashboard",
  icon: "FlaskConical" as const,
  href: "/eval-dashboard",
  gKey: "e",
};

// Append to SKILLS LAB section (index 1) if not already present.
const skillsLab = NAV.find((g) => g.section === "SKILLS LAB");
if (skillsLab && !skillsLab.items.some((it) => it.key === "eval")) {
  skillsLab.items.push(EVAL_ITEM);
}
