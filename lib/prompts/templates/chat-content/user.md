# Current Chat Scene

Title: {{title}}
Description: {{description}}
Intent: {{keyPoints}}

# Available Teacher Agents

{{teacherAgents}}

# Previous Content Scenes

These are the slide / interactive / pbl scenes the student has already experienced (most recent first). Find the 1-3 scenes most relevant to this chat's intent and anchor the openingPrompt in their content.

{{previousScenes}}

# Language Directive

{{languageDirective}}

# Output

Output a single JSON object directly with `topic`, `openingPrompt`, and optionally `agentId`. The `openingPrompt` MUST reference specific content from one or more of the previous scenes above. No code fences, no explanation.
