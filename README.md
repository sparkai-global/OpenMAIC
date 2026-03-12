# OpenMAIC

AI-powered interactive classroom platform. Generate engaging, multi-agent lesson presentations from a simple topic — complete with slides, dialogues, quizzes, and multimedia.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FTHU-MAIC%2FOpenMAIC&envDescription=Configure%20at%20least%20one%20LLM%20provider%20API%20key%20(e.g.%20OPENAI_API_KEY%2C%20ANTHROPIC_API_KEY).%20All%20providers%20are%20optional.&envLink=https%3A%2F%2Fgithub.com%2FTHU-MAIC%2FOpenMAIC%2Fblob%2Fmain%2F.env.example&project-name=openmaic&framework=nextjs)

## Features

- **AI Lesson Generation** — Describe a topic and get a full interactive classroom experience
- **Multi-Agent Dialogue** — AI teacher and student agents engage in natural classroom conversation
- **Rich Multimedia** — Auto-generated slides, images, TTS audio, and video
- **Multi-Provider Support** — OpenAI, Anthropic, Google, DeepSeek, Qwen, and more
- **Internationalization** — Chinese and English UI
- **Local-First Data** — All user data stored in browser (IndexedDB)

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm

### Install & Run

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Configuration

Copy `.env.example` to `.env.local` and add your API keys:

```bash
cp .env.example .env.local
```

At minimum, configure one LLM provider (e.g. `OPENAI_API_KEY`). See [`.env.example`](.env.example) for all available options.

Alternatively, create a `server-providers.yml` file for more advanced provider configuration.

## Deploy

### Vercel (Recommended)

Click the button above, or:

1. Fork this repository
2. Import into [Vercel](https://vercel.com/new)
3. Set environment variables (at minimum one LLM API key)
4. Deploy

### Docker

```bash
docker build -t openmaic .
docker run -p 3000:3000 --env-file .env.local openmaic
```

## License

MIT
