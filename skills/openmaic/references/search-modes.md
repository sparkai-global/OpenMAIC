# Web Search Modes

## Goal

Let the user decide whether OpenMAIC should use web search during generation.

## Options

### 1. Disabled

Recommended for first setup.

Why:

- No extra API key
- Lower cost
- Fewer moving parts during initial bring-up

### 2. Enabled With Tavily

Use when the user wants fresher, current web context in generated classrooms.

Why:

- Better for current-events or rapidly changing topics
- Requires `TAVILY_API_KEY`

## Configuration

Environment variable:

```env
TAVILY_API_KEY=tvly-...
```

Or `server-providers.yml`:

```yaml
web-search:
  tavily:
    apiKey: tvly-...
```

## Recommendation

- Recommend `Disabled` on first setup.
- Recommend `Enabled With Tavily` only if the user explicitly wants current web context.

## Confirmation Requirement

Ask the user which search mode they want before editing config or asking for another key.
