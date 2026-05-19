import type { Message } from "../../types.js";
import { contentTerms } from "../text/terms.js";
import { hasReentryCue } from "./reentryCues.js";
import type { ReentrySegmentRange } from "./types.js";

export function isMeaningfulReentryMessage(message: Message): boolean {
  const tokenEstimate = message.content.trim().split(/\s+/).filter(Boolean).length;
  return tokenEstimate >= 5 || hasReentryCue(message.content);
}

export function segmentHasReentryCue(segment: ReentrySegmentRange, messages: Message[]): boolean {
  for (let index = segment.start; index <= segment.end; index += 1) {
    const message = messages[index];
    if (message?.role === "user" && hasReentryCue(message.content)) return true;
  }

  return false;
}

export function segmentMeaningfulTerms(segment: ReentrySegmentRange, messages: Message[]): Set<string> {
  const terms = new Set<string>();

  for (let index = segment.start; index <= segment.end; index += 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    if (!isMeaningfulReentryMessage(message)) continue;

    for (const term of contentTerms(message.content)) {
      terms.add(term);
    }
  }

  return terms;
}
