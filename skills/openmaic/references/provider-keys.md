# Provider Keys

## Critical Boundary

OpenMAIC generation does not automatically reuse the OpenClaw agent's current model or API key.

OpenMAIC server APIs resolve their own model and provider keys from OpenMAIC server-side config.

## Interaction Policy

- Do not begin by asking the user to paste an API key into chat.
- First, recommend a provider path.
- Then ask how the user wants to configure it.
- The user should edit `.env.local` or `server-providers.yml` themselves.
- Do not offer to write the key for them.
- Do not ask for the literal key in chat.

## Preferred User Flow

1. Recommend a provider option.
2. Ask where the user wants to configure it:
   - `.env.local` (recommended for most users)
   - `server-providers.yml`
3. Tell the user exactly which variables or YAML fields to edit.
4. Wait for the user to confirm they finished editing before continuing.

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

## Recommended Prompts To The User

Preferred:

- "I recommend configuring OpenMAIC through `.env.local` first. Please edit that file locally and tell me when you're done."
- "For the simplest setup, I recommend Anthropic. For better speed/cost balance, I recommend Google plus `DEFAULT_MODEL=google:gemini-3-flash-preview`. Which path do you want?"

Avoid as the first move:

- "Send me your API key"
- "Paste your API key here"
- "Do you want me to write the key for you?"

## Confirmation Requirements

- Recommend one provider path first.
- Ask the user which config-file path they want.
- Instruct the user to modify the file themselves.
- Wait for the user to confirm they finished editing before continuing.
- Do not request the literal key.
