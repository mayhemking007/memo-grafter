import type { Message } from "../types.js";

export function buildIntentShiftPrompt(recentMessages: Message[], currentMessage: Message): string {
  const recent = recentMessages.map((message) => `[${message.role}]: ${message.content}`).join("\n");

  return [
    "You are a conversation topic classifier.",
    "Given recent conversation messages and a new message, determine if the new message starts a new topic or continues the current one.",
    `Recent messages: ${recent}`,
    `New message: ${currentMessage.content}`,
    "Reply with exactly one word: NEW_TOPIC or CONTINUATION",
  ].join("\n");
}
