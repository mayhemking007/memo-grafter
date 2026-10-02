import type { DocumentInput } from "../../src/ingestion/structuredDocument.js";

export const structuredFixture: DocumentInput = {
  id: "handbook", title: "Engineering handbook", url: "https://example.test/handbook", metadata: { revision: 3, labels: ["engineering"] },
  sections: [
    { id: "decisions", title: "Decisions", content: "Use TypeScript. Do not remove audit logs. Review on 2027-01-02." },
    { id: "checklist", title: "Checklist", content: "- Preserve input\n- Validate output\n  - Keep evidence\n\n1. Build\n2. Verify" },
    { id: "code", title: "Example", url: "https://example.test/handbook#code", content: "```ts\nconst title = '# not a heading';\nconsole.log('hello');\n```" },
    { id: "unicode", title: "Languages", content: "日本語 नमस्ते café e\u0301 👩🏽‍💻 😀.\n\nKeep every character." },
    { id: "long", title: "Long section", metadata: { category: "reference" }, content: "Long source text with preserved whitespace.\n".repeat(120) },
  ],
};
