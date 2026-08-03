import type { AccuracyCase } from "./types.js";

export const accuracyCases: AccuracyCase[] = [
  {
    id: "basic-preference-recall",
    description: "Forms durable Kyoto preferences and uses them in recall, grafting, and the answer.",
    conversation: [
      { role: "user", content: "When I visit Kyoto, I prefer quiet neighborhoods and small independent cafes." },
      { role: "assistant", content: "I will remember your preference for peaceful Kyoto areas and small cafes." },
      { role: "user", content: "I also like uncrowded temples and used bookstores." },
      { role: "assistant", content: "I will include uncrowded temples and used bookstores in your travel preferences." },
    ],
    expectedTopics: [
      { name: "Kyoto travel preferences", requiredTerms: ["kyoto", "quiet", "cafe"], messageRange: [0, 3] },
    ],
    expectedMemories: [
      { name: "quiet Kyoto neighborhoods", requiredTerms: ["quiet", "neighborhood"] },
      { name: "small independent cafes", requiredTerms: ["small", "cafe"] },
      { name: "uncrowded temples or used bookstores", requiredTerms: ["uncrowded", "temple"] },
    ],
    checkpoint: {
      query: "What kind of Kyoto itinerary would suit me?",
      expectedFacts: [
        { name: "quiet neighborhoods", requiredTerms: ["quiet", "neighborhood"] },
        { name: "small cafes", requiredTerms: ["small", "cafe"] },
      ],
      answerRequirements: ["quiet", "cafe"],
    },
  },
  {
    id: "topic-switching",
    description: "Separates travel from a software-career discussion and retrieves only the requested subject.",
    conversation: [
      { role: "user", content: "I am planning a calm Kyoto trip and prefer neighborhood cafes." },
      { role: "assistant", content: "I will remember those Kyoto travel preferences." },
      { role: "user", content: "I enjoy used bookstores and quiet gardens when travelling." },
      { role: "assistant", content: "Those preferences are noted for the trip." },
      { role: "user", content: "Now I need a software engineering cover letter for a TypeScript role." },
      { role: "assistant", content: "Let us switch to your TypeScript job application." },
      { role: "user", content: "The letter should emphasize API design and mentoring experience." },
      { role: "assistant", content: "I will emphasize API design and mentoring." },
    ],
    expectedTopics: [
      { name: "Kyoto travel", requiredTerms: ["kyoto", "travel"], messageRange: [0, 3] },
      { name: "TypeScript job application", requiredTerms: ["typescript", "software"], messageRange: [4, 7] },
    ],
    expectedMemories: [
      { name: "quiet travel preference", requiredTerms: ["quiet", "travel"] },
      { name: "TypeScript role", requiredTerms: ["typescript", "role"] },
      { name: "API design and mentoring", requiredTerms: ["api", "mentoring"] },
    ],
    checkpoint: {
      query: "Which Kyoto activities match my travel style?",
      expectedFacts: [{ name: "quiet Kyoto travel", requiredTerms: ["kyoto", "quiet"] }],
      forbiddenFacts: [{ name: "job application", requiredTerms: ["typescript", "cover"] }],
      answerRequirements: ["kyoto", "quiet"],
    },
  },
  {
    id: "irrelevant-memory-filtering",
    description: "Distinguishes the user's preferences from a relative's similar travel information.",
    conversation: [
      { role: "user", content: "For my Kyoto trip, I prefer quiet mornings, tea houses, and small cafes." },
      { role: "assistant", content: "Your Kyoto preferences are quiet mornings, tea houses, and small cafes." },
      { role: "user", content: "My brother is visiting Osaka and he prefers nightlife and crowded music venues." },
      { role: "assistant", content: "Your brother's Osaka preferences are nightlife and crowded music venues." },
    ],
    expectedTopics: [
      { name: "User Kyoto preferences", requiredTerms: ["kyoto", "quiet"], messageRange: [0, 1] },
      { name: "Brother Osaka preferences", requiredTerms: ["brother", "osaka"], messageRange: [2, 3] },
    ],
    expectedMemories: [
      { name: "user likes quiet Kyoto mornings", requiredTerms: ["quiet", "kyoto"] },
      { name: "brother likes Osaka nightlife", requiredTerms: ["brother", "nightlife"] },
    ],
    checkpoint: {
      query: "Plan a morning in Kyoto based on my own preferences.",
      expectedFacts: [{ name: "user's quiet Kyoto preference", requiredTerms: ["quiet", "kyoto"] }],
      forbiddenFacts: [{ name: "brother's nightlife preference", requiredTerms: ["brother", "nightlife"] }],
      answerRequirements: ["quiet", "kyoto"],
    },
  },
];
