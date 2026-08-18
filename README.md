# Agent harness integration

This demo connects a server-side agent harness and a browser-based SuperDoc editor to the same collaborative document.

## Architecture

```mermaid
flowchart TD
  webapp[SuperDoc browser client]

  subgraph server[Agentic loop server]
    direction TB
    loop[Agentic loop]
    client[SuperDoc SDK client]
    loop -->|tool dispatch| client
  end

  ws[WebSocket server]

  webapp -->|HTTP request / response| loop
  client <-->|WebSocket sync| ws
  webapp <-->|WebSocket sync| ws

  classDef blue fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
  class webapp,ws blue
```

## Run the demo

Requires Node.js 22.12 or newer and pnpm 10.

```bash
pnpm install
cp .env.example .env
```

Add your OpenAI API key to `.env`:

```dotenv
OPENAI_API_KEY=your-key
OPENAI_MODEL=gpt-4.1-mini
```

Start the browser app, agent-loop server, and WebSocket server:

```bash
pnpm dev
```

Open [http://localhost:5173](http://localhost:5173), enter a document instruction, and select **Run agent**.
