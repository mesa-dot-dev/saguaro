---
name: saguaro-model
description: Switch the AI model used for Saguaro code reviews
---
## Flow

1. **Fetch catalog** — Call `saguaro_get_models` once (no arguments). This returns all providers with their models (sorted newest-first, recommended flagged), the current model, and `api_key_configured` per provider.

2. **Show current model** — If `current` is set, display: "Current model: {provider} / {model}". Otherwise: "No model configured."

3. **Pick a provider** — Use `AskUserQuestion` with structured options built from the providers returned in step 1. Example:

   ```
   AskUserQuestion({
     questions: [{
       question: "Which provider would you like to use?",
       header: "Provider",
       options: [
         // Build these from the providers array returned by saguaro_get_models
         { label: "Anthropic", description: "Claude models" },
         { label: "OpenAI", description: "GPT models" },
         { label: "Google", description: "Gemini models" }
       ],
       multiSelect: false
     }]
   })
   ```

4. **Pick a model** — From the step 1 data, find the selected provider's model list. Present the models as a numbered text list — do NOT use AskUserQuestion (there are too many models for 4 options). Format each line as:

```
  1. model-id — Label (recommended)
  2. model-id — Label
  ...
```

Then ask: "Pick a number, or type a model ID directly."

IMPORTANT: Use the exact `id` field from the catalog as the model identifier. Do NOT modify, reformat, or abbreviate model IDs.

5. **Set the model** — Call `saguaro_set_model` with the exact `provider` and `model` id. If `saguaro_set_model` returns an error, show the error and do NOT retry with a modified model ID.

6. **API key** — Check `api_key_configured` from the `saguaro_set_model` response. If `false`, tell the user: "No {envKey} found. Paste your key or type 'n' to skip." If they provide a key, call `saguaro_set_model` again with the `api_key` field.

7. **Confirm** — Say the model was updated. If the `overrides` field is present in the `saguaro_get_models` response, also list any active per-review-kind overrides. Always end with: "You can set per-review-kind model overrides directly in .saguaro/config.yaml under review.rules.model, review.classic.model, and daemon.model."
