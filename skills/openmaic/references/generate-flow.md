# Generate Flow

## Preconditions

- Repo path is confirmed
- Startup mode has been chosen
- OpenMAIC is healthy at the selected `url`
- Provider keys are configured

## Requirement-Only Generation

Send a JSON request to:

```text
POST {url}/api/generate-classroom
```

Request body:

```json
{
  "requirement": "Create an introductory classroom on quantum mechanics for high school students"
}
```

## PDF-Based Generation

1. Resolve the absolute path to the PDF.
2. Confirm before reading the file.
3. Parse the PDF first:

```text
POST {url}/api/parse-pdf
```

4. Then send `requirement` plus `pdfContent` to:

```text
POST {url}/api/generate-classroom
```

## What To Return

Return the generated classroom URL and ID.

If generation fails, surface the server error directly instead of paraphrasing it away.

## Confirmation Requirements

- Ask before reading a local PDF.
- Ask before sending the generation request.
