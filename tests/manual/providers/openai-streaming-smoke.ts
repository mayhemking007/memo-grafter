import { OpenAILLMAdapter } from "../../../src/index.js";

let streamed = "";
const llm = new OpenAILLMAdapter("gpt-4o-mini", {
  streaming: true,
  onChunk: (chunk) => {
    streamed += chunk;
    process.stdout.write(chunk);
  },
});

const response = await llm.complete(
  [
    {
      role: "user",
      content: "Reply with one short sentence about why response streaming is useful.",
    },
  ],
  "Keep the answer concise.",
);

process.stdout.write("\n\n");
console.log("Returned response:", response);

if (!streamed) {
  throw new Error("Expected at least one streamed chunk.");
}

if (streamed !== response) {
  throw new Error("Expected streamed chunks to match the returned response.");
}

console.log("OpenAI streaming smoke passed.");
