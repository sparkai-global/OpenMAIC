# Provider Keys

## Critical Boundary

OpenMAIC generation does not automatically reuse the OpenClaw agent's current model or API key.

OpenMAIC server APIs resolve their own model and provider keys from OpenMAIC server-side config.

## Recommendation Paths

### 1. Lowest-Friction Setup

Recommended when the user wants the smallest amount of configuration.

Set:

```env
ANTHROPIC_API_KEY=sk-ant-...
```

Why:

- OpenMAIC server fallback currently points at an Anthropic model if `DEFAULT_MODEL` is unset.

### 2. Better Speed / Cost Balance

Recommended when the user is willing to set one extra variable.

Set:

```env
GOOGLE_API_KEY=...
DEFAULT_MODEL=google:gemini-3-flash-preview
```

Why:

- Good quality-to-speed balance
- Matches the repo's current recommendation direction better than the default fallback

### 3. Existing Provider Reuse

Use when the user already has OpenAI or another supported provider configured and wants to stick with it.

Examples:

```env
OPENAI_API_KEY=sk-...
DEFAULT_MODEL=openai:gpt-4o-mini
```

```env
DEEPSEEK_API_KEY=...
DEFAULT_MODEL=deepseek:deepseek-chat
```

## Preferred Config Method

For first setup, prefer `.env.local`:

```bash
cp .env.example .env.local
```

Then fill the chosen keys.

Alternative: `server-providers.yml`

```yaml
providers:
  anthropic:
    apiKey: sk-ant-...

  google:
    apiKey: ...

  openai:
    apiKey: sk-...
```

If using a non-default provider for classroom generation, also set the model selection explicitly:

```env
DEFAULT_MODEL=google:gemini-3-flash-preview
```

## Confirmation Requirements

- Recommend one provider path first.
- Ask the user which path they want.
- Ask before writing `.env.local` or `server-providers.yml`.
