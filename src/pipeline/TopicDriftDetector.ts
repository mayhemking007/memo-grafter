import type { Message } from "../types.js";
import { cosineSimilarity } from "../utils/drift/cosineSimilarity.js";
import { avg } from "../utils/drift/vectorAvg.js";

export interface DriftState {
  window: number[][];
  topicEmbeddings: number[][];
  currentSegmentStart: number;
  lastMessageIndex: number | null;
  topicOrder: number;
}

export interface DriftSegment {
  start: number;
  end: number;
  topicOrder: number;
  driftScore: number;
}

export interface DriftResult {
  state: DriftState;
  segment?: DriftSegment;
}

export class TopicDriftDetector {
  constructor(
    private readonly config: {
      windowSize: number;
      threshold: number;
      mode: "window" | "intent";
      minSegmentMessages: number;
    },
  ) {
    if (config.windowSize % 2 !== 0) {
      throw new Error("MemoGrafter drift.windowSize must be even because drift detection compares two equal window halves.");
    }
  }

  createInitialState(firstMessageIndex: number): DriftState {
    return {
      window: [],
      topicEmbeddings: [],
      currentSegmentStart: firstMessageIndex,
      lastMessageIndex: null,
      topicOrder: 1,
    };
  }

  processMessage(state: DriftState, message: Message, embedding: number[], messageIndex: number): DriftResult {
    if (this.config.mode === "intent") {
      return this.processIntentMessage(state, message, embedding, messageIndex);
    }

    return this.processWindowMessage(state, embedding, messageIndex);
  }

  createFinalSegment(state: DriftState): DriftSegment | null {
    if (state.lastMessageIndex === null || state.currentSegmentStart > state.lastMessageIndex) {
      return null;
    }

    return {
      start: state.currentSegmentStart,
      end: state.lastMessageIndex,
      topicOrder: state.topicOrder,
      driftScore: 0,
    };
  }

  private processIntentMessage(
    state: DriftState,
    message: Message,
    embedding: number[],
    messageIndex: number,
  ): DriftResult {
    if (message.role !== "user") {
      return {
        state: { ...state, lastMessageIndex: messageIndex },
      };
    }

    if (state.topicEmbeddings.length < this.config.minSegmentMessages) {
      return {
        state: {
          ...state,
          topicEmbeddings: [...state.topicEmbeddings, embedding],
          lastMessageIndex: messageIndex,
        },
      };
    }

    const topicAverage = avg(state.topicEmbeddings);
    const driftScore = 1 - cosineSimilarity(topicAverage, embedding);
    if (driftScore > this.config.threshold && state.lastMessageIndex !== null) {
      return {
        state: {
          window: [],
          topicEmbeddings: [embedding],
          currentSegmentStart: messageIndex,
          lastMessageIndex: messageIndex,
          topicOrder: state.topicOrder + 1,
        },
        segment: {
          start: state.currentSegmentStart,
          end: state.lastMessageIndex,
          topicOrder: state.topicOrder,
          driftScore,
        },
      };
    }

    return {
      state: {
        ...state,
        topicEmbeddings: [...state.topicEmbeddings, embedding],
        lastMessageIndex: messageIndex,
      },
    };
  }

  private processWindowMessage(state: DriftState, embedding: number[], messageIndex: number): DriftResult {
    const newWindow = state.window.length >= this.config.windowSize
      ? [...state.window.slice(1), embedding]
      : [...state.window, embedding];

    if (newWindow.length < this.config.windowSize) {
      return {
        state: { ...state, window: newWindow, lastMessageIndex: messageIndex },
      };
    }

    const half = this.config.windowSize / 2;
    const prevAvg = avg(newWindow.slice(0, half));
    const currAvg = avg(newWindow.slice(half));
    const driftScore = 1 - cosineSimilarity(prevAvg, currAvg);
    const secondLastMessageIndex = this.secondLastMessageIndex(state.lastMessageIndex);

    if (driftScore > this.config.threshold && state.lastMessageIndex !== null && secondLastMessageIndex !== null) {
      return {
        state: {
          window: [],
          topicEmbeddings: [],
          currentSegmentStart: state.lastMessageIndex,
          lastMessageIndex: state.lastMessageIndex,
          topicOrder: state.topicOrder + 1,
        },
        segment: {
          start: state.currentSegmentStart,
          end: secondLastMessageIndex,
          topicOrder: state.topicOrder,
          driftScore,
        },
      };
    }

    return {
      state: { ...state, window: newWindow, lastMessageIndex: messageIndex },
    };
  }

  private secondLastMessageIndex(lastMessageIndex: number | null): number | null {
    if (lastMessageIndex === null || lastMessageIndex === 0) return null;
    return lastMessageIndex - 1;
  }
}
