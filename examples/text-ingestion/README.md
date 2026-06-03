# Text Ingestion Example

This example ingests editor or document text into MemoGrafter without generating an assistant response.

```ts
await agent.ingestText(editorContent, {
  replace: true,
  label: "Morning entry",
  source: "classic-editor",
});
```

Use `replace: true` when each call contains the complete current document, such as a debounced editor autosave. Omit it when importing text incrementally.

Run from the repository root after configuring `DATABASE_URL` and `OPENAI_API_KEY`:

```bash
npx tsx --env-file=.env examples/text-ingestion/src/index.ts
```
