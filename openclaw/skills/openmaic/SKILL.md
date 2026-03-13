# OpenMAIC - Multi-Agent Interactive Classroom

## What is OpenMAIC?

OpenMAIC is an AI-powered interactive classroom generator. It takes educational content (PDF documents or free-form requirements) and generates rich, multi-agent interactive classroom presentations with slides, quizzes, interactive simulations, AI teacher agents, and more.

## Available Tools

### `openmaic_manage` — Lifecycle Management

Use this tool when the user wants to deploy, start, stop, or check the status of OpenMAIC.

**Parameters:**
- `action`: One of `status`, `start`, `stop`, `install`

**When to use:**
- User wants to deploy or start OpenMAIC → `{ action: "start" }`
- User wants to stop OpenMAIC → `{ action: "stop" }`
- User wants to check if OpenMAIC is running → `{ action: "status" }`
- User wants to install dependencies → `{ action: "install" }`

### `openmaic_generate` — Generate a Classroom

Use this tool when the user wants to create a lesson, classroom, or course.

**Parameters:**
- `requirement` (required): Free-form text describing what to generate. Can include topic, student background, teaching style, difficulty, duration, or any other instructions — no restrictions.
- `pdfPath` (optional): Path to a PDF file to use as source material. When provided, the PDF is parsed and its content is sent alongside the requirement.

**How to handle PDF files:**

When the user provides a PDF, you need to determine its **absolute path** on the filesystem and pass it as `pdfPath`. The requirement should describe what kind of classroom to generate from the PDF content.

- User uploads or references a file → resolve to absolute path → pass as `pdfPath`
- Combine with `requirement` to give context: what to focus on, target audience, language, etc.

**When to use:**
- User says "create a classroom about quantum mechanics" → `{ requirement: "quantum mechanics" }`
- User says "generate a classroom from this PDF" (with a file) → `{ requirement: "Generate a classroom based on the PDF material", pdfPath: "/path/to/file.pdf" }`
- User says "make a linear algebra course for freshmen" → `{ requirement: "Introductory linear algebra course for college freshmen" }`
- User says "this PDF is too hard, make a simpler version" → `{ requirement: "Generate a simplified classroom based on the PDF, lower difficulty, add more examples", pdfPath: "/path/to/file.pdf" }`

## Example Flows

### Deploy and Generate
```
User: "Deploy OpenMAIC and generate a classroom about machine learning"
1. openmaic_manage { action: "start" }
2. openmaic_generate { requirement: "Introductory machine learning classroom" }
3. Return the classroom URL to the user
```

### Generate from PDF
```
User: "Generate a classroom from this PDF" (attaches file.pdf)
1. openmaic_generate { requirement: "Generate a classroom based on the PDF material", pdfPath: "/path/to/file.pdf" }
2. Return the classroom URL to the user
```

### Check Status
```
User: "Is OpenMAIC running?"
1. openmaic_manage { action: "status" }
2. Report the status to the user
```
