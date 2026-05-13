import type { Message } from "../types.js";
import { normalizeText } from "../utils/normalizeText.js";

export function buildSegmentExtractionPrompt(messages: Message[]): string {
  const messageContent = messages
    .map((message, index) => `Message ${index + 1}:\n[${message.role}] ${normalizeText(message.content) ?? message.content}`)
    .join("\n\n");

  return [
    "Analyze this conversation segment and extract structured memory for a future chatbot.",
    "",
    "Identify:",
    "- The core topic being discussed",
    "- What the user wanted to know, do, or accomplish",
    "- What the assistant provided, decided, or concluded",
    "- Any unresolved questions or open threads",
    "",
    "Respond only in this exact format with no extra text:",
    "LABEL: <3-6 word topic label>",
    "USER_INTENT: <two-three sentences describing what the user was trying to achieve or understand>",
    "OUTCOME: <one-two sentences describing what was concluded, decided, or provided>",
    "OPEN: <one sentence describing any unresolved question or follow-up, or None if fully resolved>",
    "",
    "Conversation segment:",
    messageContent,
  ].join("\n");
}
