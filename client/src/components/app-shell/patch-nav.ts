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


// gKey "r" chosen for CI Runs — avoids collision with "c" (conventions),
// "e" (eval), "s" (skills), "a" (agents), "p" (pulls), "o" (onboarding), "x" (context).
// Plan suggested "c" but that collides with conventions in the same section.
// "Workflow" icon used — "Rocket" is not in the Icon registry.
const CI_RUNS_ITEM = {
  key: "ci-runs",
  label: "CI Runs",
  icon: "Workflow" as const,
  href: "/ci-runs",
  gKey: "r",
};

const MULTI_AGENT_ITEM = {
  key: "multi-agent-review",
  label: "Multi-Agent Review",
  icon: "Users" as const,
  href: "/multi-agent-review/configure",
  gKey: "m",
};

// gKey "f" chosen for Agent Performance (mnemonic: perFormance) — avoids
// collision with "c" (conventions), "e" (eval), "s" (skills), "a" (agents),
// "p" (pulls), "o" (onboarding), "x" (context), "r" (CI Runs), "m" (multi-
// agent review). Kept distinct from the Eval Dashboard item — both remain
// in nav (Step 14).
const AGENT_PERFORMANCE_ITEM = {
  key: "agent-performance",
  label: "Agent Performance",
  icon: "Gauge" as const,
  href: "/agent-performance",
  gKey: "f",
};

// Append to SKILLS LAB section (index 1) if not already present.
const skillsLab = NAV.find((g) => g.section === "SKILLS LAB");
if (skillsLab && !skillsLab.items.some((it) => it.key === "eval")) {
  skillsLab.items.push(EVAL_ITEM);
}
if (skillsLab && !skillsLab.items.some((it) => it.key === "ci-runs")) {
  skillsLab.items.push(CI_RUNS_ITEM);
}
if (skillsLab && !skillsLab.items.some((it) => it.key === "multi-agent-review")) {
  skillsLab.items.push(MULTI_AGENT_ITEM);
}

// Vendor NAV has no GLOBAL section — create it (sanctioned extension point,
// vendor/ui is read-only) and push the Agent Performance item into it.
let global = NAV.find((g) => g.section === "GLOBAL");
if (!global) {
  global = { section: "GLOBAL", items: [] };
  NAV.push(global);
}
if (!global.items.some((it) => it.key === "agent-performance")) {
  global.items.push(AGENT_PERFORMANCE_ITEM);
}
