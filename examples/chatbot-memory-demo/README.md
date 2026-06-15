# Chatbot Memory Demo

This example demonstrates the MemoGrafter V1 chatbot memory and grafting workflow with two chatbot agents:

- `travelBot` learns a user's Japan travel preferences.
- `writingBot` starts as a separate chatbot, then absorbs selected travel memory.

The demo stays focused on V1 memory behavior. It does not include a frontend, tools, or an agentic runtime.

## What This Demo Shows

1. Creating two `MemoGrafterAgent` instances.
2. Having a short conversation with the first chatbot.
3. Inspecting generated topic nodes from the first chatbot.
4. Selecting related memory with semantic grafting.
5. Absorbing selected memory into the second chatbot.
6. Asking the second chatbot to use the transferred context.

## Requirements

- Node.js 18 or newer.
- PostgreSQL with the `pgvector` extension enabled.
- An OpenAI API key.
- The root MemoGrafter project dependencies installed.

## Installation

From the root of this repository:

```bash
npm install
npm run build
```

Then move into the example folder:

```bash
cd examples/chatbot-memory-demo
npm install
```

This example imports MemoGrafter from the root repository build because the npm package name is not finalized yet. Run `npm run build` from the root project before running this demo.

## Environment Setup

Create an `.env` file in this example folder:

```bash
cp .env.example .env
```

Fill in:

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/memo_grafter
OPENAI_API_KEY=sk-...
```

`DATABASE_URL` must point to a PostgreSQL database where `pgvector` is available.

Run the MemoGrafter migration before starting the demo:

```bash
npx memo-grafter migrate
```

## How To Run

Run the TypeScript demo directly:

```bash
npm run dev
```

Or build and run the compiled JavaScript:

```bash
npm run build
npm start
```

## Expected Flow

The script first asks `travelBot` about a Japan trip, quiet towns, bookstores, local cafes, and budget.

After the conversation, it prints active topic nodes created by MemoGrafter. Then `writingBot` absorbs memory related to:

```text
Japan travel preferences
```

Finally, `writingBot` is asked:

```text
Suggest a reflective blog intro for my Japan trip.
```

The response should reflect the transferred context, such as quiet towns, bookstores, local cafes, or the budget.
