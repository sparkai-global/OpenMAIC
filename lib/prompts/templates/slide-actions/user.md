Elements: {{elements}}
Title: {{title}}
Key Points: {{keyPoints}}
Description: {{description}}
{{courseContext}}
{{agents}}
{{userProfile}}

**Language Directive**: {{languageDirective}}

Output as a JSON array directly (no explanation, no code fences, 6-12 segments). The FIRST element MUST be a `text` object that poses a question / prediction / contrast — NOT a direct conclusion, NOT an introduction sentence, NOT a spotlight. Phrase the hook in the course language specified by the Language Directive. Example shape (the content fields are real spoken text — do NOT copy verbatim, write your own based on this page's content):

[{"type":"text","content":"Before I show you, take a guess — which of these two values do you think will be larger, and why?"},{"type":"text","content":"…"},{"type":"action","name":"spotlight","params":{"elementId":"text_xxx"}},{"type":"text","content":"It turns out the second one is larger, and here's the key reason."}]
