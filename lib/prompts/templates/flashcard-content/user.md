# Current Flashcard Scene

Title: {{title}}
Description: {{description}}
Intent: {{keyPoints}}

# Source Scene (Immediately Preceding)

This is the scene the student just experienced. Extract flashcards STRICTLY from this content.

## Scene Title
{{sourceTitle}}

## Scene Description
{{sourceDescription}}

## Scene Key Points
{{sourceKeyPoints}}

## Visual Content (what was shown on screen)
{{sourceVisualContent}}

## Teacher Speech (what was actually said during the scene)
{{sourceSpeechContent}}

# Language Directive

{{languageDirective}}

# Output

Output a JSON array of 3-5 flashcard objects directly. If the source scene does not contain enough memorizable items to produce at least 3 high-quality cards, output `[]` instead. Do NOT invent content. No code fences, no explanation.
