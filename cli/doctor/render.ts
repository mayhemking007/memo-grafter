import type { DoctorResult, DoctorStatus } from "./types.js";

const sectionOrder = ["Runtime", "Configuration", "PostgreSQL", "Database", "Redis"];
const symbols: Record<DoctorStatus, string> = {
  passed: "✓",
  failed: "✗",
  warning: "!",
  skipped: "○",
};

export function renderDoctor(results: DoctorResult[]): string {
  const lines = ["MemoGrafter Doctor"];

  for (const section of sectionOrder) {
    const sectionResults = results.filter((result) => result.section === section);
    if (sectionResults.length === 0) continue;
    lines.push("", section);
    for (const result of sectionResults) {
      lines.push(`${symbols[result.status]} ${result.label}${result.message ? ` ${result.message}` : ""}`);
      for (const help of result.help ?? []) lines.push(`  ${help}`);
    }
  }

  const requiredFailures = results.filter((result) =>
    result.required && result.status === "failed"
  );
  lines.push("", "Summary");
  if (requiredFailures.length === 0) {
    lines.push("✓ MemoGrafter is ready");
  } else {
    const noun = requiredFailures.length === 1 ? "check failed" : "checks failed";
    lines.push(`✗ MemoGrafter needs attention — ${requiredFailures.length} required ${noun}`);
  }

  return lines.join("\n");
}
