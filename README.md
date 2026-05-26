# Selection Translator

Selection Translator is an Obsidian plugin for translating selected text, paragraphs, Markdown notes, embedded images, and speech output from inside your vault.

## Features

- Translate selected text or the current paragraph from the command palette, editor menu, or ribbon menu.
- Open a quick translation panel for ad hoc text translation.
- Translate a Markdown file into a linked side-by-side note.
- Show immersive bilingual translations in reading mode.
- Translate embedded images through the configured image translation provider.
- Play translated text with Web Speech, OpenAI-compatible TTS, or Azure Speech.
- Configure AI, machine translation, prompt presets, cache, queue, display, and privacy settings.

## Privacy and external services

The plugin does not collect analytics and does not upload vault content in the background.

Text, images, or speech requests are sent only when you actively use translation, TTS, model listing, connection testing, or image translation with a configured provider. API keys are stored in Obsidian plugin data; hidden inputs prevent casual viewing but do not encrypt the stored values. Translation cache entries are stored locally in plugin settings and can be cleared or disabled from the plugin settings.

Supported external services depend on your configuration and may include OpenAI-compatible APIs, DeepSeek, OpenRouter, Gemini, Claude, Ollama, Google Cloud Translation, Azure Translator, AWS Translate, DeepL/DeepLX, Baidu, Youdao, OpenAI Images, OpenAI TTS, and Azure Speech.

## Development

Install dependencies:

```bash
npm install
```

Run the development build watcher:

```bash
npm run dev
```

Create a production build:

```bash
npm run build
```

Run lint checks:

```bash
npm run lint
```

## Release

Release tags must exactly match `manifest.json` version, without a leading `v`.

The release workflow builds `main.js`, verifies `manifest.json` and `versions.json`, generates GitHub artifact attestations, and uploads `manifest.json`, `main.js`, and `styles.css` to the GitHub release.

For manual local testing, copy `main.js`, `manifest.json`, and `styles.css` into:

```text
<Vault>/.obsidian/plugins/selection-translator/
```
