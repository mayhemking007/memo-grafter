# Basic Chat Memory Demo

This example demonstrates the smallest useful MemoGrafter flow with a single
`MemoGrafterAgent`.

It keeps the setup focused on one chatbot that:

1. stores a short conversation,
2. builds topic memory in the background,
3. prints the active topic nodes, and
4. recalls the user's saved preferences with `agent.recall()`.

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
cd examples/basic-chat-memory
npm install
```

This example imports MemoGrafter from the root repository build. Run `npm run build`
from the root project before running this demo.

## Environment Setup

Create an `.env` file in this example folder:

```bash
cp .env.example .env
```

Fill in:

```bash
DATABASE_URL=postgres://postgres:***@localhost:5432/memo_grafter
OPENAI_API_KEY=sk-...
```

`DATABASE_URL` must point to a PostgreSQL database where `pgvector` is available.

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

The script walks through a short travel-planning conversation and then prints:

- the active topic nodes extracted from the conversation, and
- the recalled facts for `Japan travel preferences`.

You should see the recalled facts mention preferences such as quiet towns,
used bookstores, local cafes, and the travel budget.
