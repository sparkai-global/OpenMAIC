# Hosted Mode

Use this when the user has an access code from open.maic.chat and wants to skip local setup.

## Access Code Setup

1. Ask the user to paste their access code (starts with `sk-`).
2. Verify connectivity: `GET https://open.maic.chat/api/health`
   - On success: confirm connection and proceed to generation.
   - On failure: suggest checking network or trying local mode.

## Generating a Classroom

Follow the same generation flow as [generate-flow.md](generate-flow.md) with these differences:

- **Base URL**: `https://open.maic.chat` (hardcoded, not configurable)
- **Authorization**: Include header `Authorization: Bearer <access-code>` on all API requests
- **Classroom URL**: `https://open.maic.chat/classroom/{id}`

## Quota

- 10 generations per day, independent of web UI quota
- If generation returns 403 with `Daily quota exhausted`, inform the user of the daily limit and that it resets at midnight.

## Error Handling

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| 401 | Invalid access code | Ask user to check their code or generate a new one at open.maic.chat |
| 403 | Quota exhausted | Inform daily limit (10), suggest trying tomorrow |
| 500 | Server error | Suggest retrying later or switching to local mode |
