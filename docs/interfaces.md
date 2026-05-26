# Selection Translator Interfaces

This document describes the current module boundaries and stable service interfaces.
It is intended for development and maintenance. Runtime code should use the facade
services on `TranslationPlugin` instead of reaching into provider or UI internals.

## Plugin Service Registry

**File:** `src/main.ts`

`TranslationPlugin` owns the long-lived service instances:

```ts
export default class TranslationPlugin extends Plugin {
	settings: TranslationPluginSettings;
	translationCache!: TranslationCache;
	requestQueueService!: RequestQueueService;
	translationMetrics!: TranslationMetricsService;
	promptService!: PromptService;
	translateService!: TranslateService;
	ttsService!: TtsService;
	documentTranslationService!: DocumentTranslationService;
	immersiveManager!: ImmersiveTranslationManager;
	sideBySideSyncManager!: SideBySideSyncManager;
	taskLogManager!: TaskLogManager;
}
```

**Use:** commands, settings tabs, panels, and managers should access business
capabilities through these plugin properties.

**Lifecycle:** services are created in `onload()`. `onunload()` stops immersive
translation, sync, TTS playback, notices, and open panels.

**Stable boundary:** callers can depend on the plugin properties existing after
`onload()`. Internal service implementations can change as long as their public
interfaces remain compatible.

## PromptService

**File:** `src/translation/prompt-service.ts`

**Purpose:** The only business entry for prompt presets, use-case prompts,
prompt building, and prompt preview.

```ts
export interface PromptService {
	build(request: TranslateRequest): BuiltTranslationPrompt;
	buildForUseCase(request: TranslateRequest, useCase: TranslationPromptUseCase): BuiltTranslationPrompt;
	listPresets(): TranslationPromptPreset[];
	preview(input: string, context?: TranslationPromptContext): BuiltTranslationPrompt;
}
```

**Callers:** settings prompt tab, `TranslateService`, immersive translation.

**Do:** call `plugin.promptService.build()`, `buildForUseCase()`,
`listPresets()`, or `preview()`.

**Do not:** build LLM prompts directly in settings, UI, or providers.

**Internal flexibility:** prompt template format, token replacement, preset
selection, and preview defaults may change behind this interface.

**Concurrency/cache:** none. Prompt building is synchronous and pure relative to
the current settings.

## TranslateService

**File:** `src/translation/translate-service.ts`

**Purpose:** The only business entry for executing translations, cached
translations, provider testing, and model listing.

```ts
export interface TranslateService {
	translate(request: TranslateRequest): Promise<TranslateResult>;
	translateWithCache(request: TranslateRequest, options?: TranslateWithCacheOptions): Promise<TranslateResult>;
	testProvider(): Promise<void>;
	listModels(): Promise<ProviderModelInfo[]>;
}
```

Important request/result types are in `src/translation/types.ts`:

```ts
export interface TranslateRequest {
	text: string;
	sourceLanguage: string;
	targetLanguage: string;
	settings: TranslationPluginSettings;
	providerConfig?: TranslationProviderConfig;
	promptContext?: TranslationPromptContext;
	builtPrompt?: BuiltTranslationPrompt;
}

export interface TranslateResult {
	text: string;
	provider: TranslationProviderId;
	sourceLanguage?: string;
	targetLanguage: string;
	raw?: unknown;
}
```

**Callers:** selection translation, current paragraph translation, quick panel,
immersive translation, side-by-side/current-file workflows, API settings tests.

**Do:** call `plugin.translateService.translateWithCache()` for user-facing
translation flows unless the caller explicitly wants to bypass cache behavior.

**Do not:** import provider adapters directly from UI, settings, commands, or
managers.

**Internal flexibility:** provider dispatch, retry details, prompt injection,
model listing, and current-provider config normalization may change internally.

**Concurrency/cache/retry:**

- `translateWithCache()` checks `TranslationCache` before queueing provider work.
- Cache misses enter the shared `RequestQueueService`.
- Concurrent duplicate requests with the same queue/cache key share one promise.
- `translate()` is a raw provider call and does not use cache or queue.
- Provider testing and model listing are not queued.

## TtsService

**File:** `src/tts/tts-service.ts`

**Purpose:** The only business entry for text-to-speech playback, stop, voice
listing, and test playback.

```ts
export type TtsProviderId = "web-speech" | "openai-tts" | "azure-speech";

export interface TtsConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	voice: string;
	region: string;
}

export interface TtsRequest {
	text: string;
	language: string;
	voice?: string;
	rate?: number;
	pitch?: number;
	volume?: number;
}

export interface TtsVoiceInfo {
	id: string;
	name: string;
	language?: string;
	provider: TtsProviderId;
}

export interface TtsService {
	speak(request: TtsRequest): Promise<void>;
	stop(): void;
	listVoices(): Promise<TtsVoiceInfo[]>;
	test(text?: string): Promise<void>;
}
```

**Callers:** TTS settings tab. Future UI can use `plugin.ttsService.speak()`.

**Do:** call `plugin.ttsService.speak()` and `stop()`.

**Do not:** call Web Speech, OpenAI speech, Azure speech, audio element, or blob
URL APIs directly from UI.

**Internal flexibility:** provider implementation, audio playback, voice listing,
and OpenAI/Azure request formats may change behind the service.

**Concurrency/cache/retry:**

- No queue.
- `speak()` stops current playback before starting new playback.
- No audio cache.
- No retry wrapper.

**Known maintenance note:** current source inspection shows some TTS/default
Chinese strings may still be mojibake in the working tree. Fixing those strings
is a separate runtime-code cleanup, not part of this interface document.

## TranslationCache

**File:** `src/translation/cache.ts`

**Purpose:** Low-level translation cache primitive. It stores translated text by
computed key and persists through plugin settings.

```ts
export interface TranslationCacheEntry {
	key: string;
	text: string;
	createdAt: number;
}

export interface TranslateWithCacheOptions {
	bypassCache?: boolean;
	cacheScope?: string;
}

export class TranslationCache {
	makeKey(request: TranslateRequest, options?: {cacheScope?: string}): Promise<string>;
	get(key: string): string | null;
	put(key: string, text: string): void;
	delete(key: string): void;
	clear(): void;
	cleanExpired(): number;
}
```

**Callers:** primarily `TranslateService`. Settings/cache UI can call clear or
cleanup operations.

**Do:** use `translateService.translateWithCache()` for business translation.

**Do not:** make normal UI flows compute cache keys and call `get()`/`put()`
directly.

**Internal flexibility:** key composition, trim policy, persistence debounce, and
expiration behavior may change.

**Cache key currently includes:** source text, source language, target language
when enabled, provider/model/base URL/region/api type when enabled, and final LLM
prompt content for LLM providers.

## TranslationProviderAdapter

**File:** `src/translation/types.ts`

**Purpose:** Internal contract between `TranslateService` and individual provider
adapters.

```ts
export interface TranslationProviderAdapter {
	id: TranslationProviderId;
	label: string;
	kind: TranslationProviderKind;
	translate(request: TranslateRequest): Promise<TranslateResult>;
	testConnection(config: TranslationProviderConfig, settings: TranslationPluginSettings): Promise<void>;
	listModels?(config: TranslationProviderConfig, settings: TranslationPluginSettings): Promise<ProviderModelInfo[]>;
}
```

**Registry:** `src/translation/providers/index.ts`

**Callers:** `TranslateService` only.

**Do:** add or change providers by implementing this adapter and registering it.

**Do not:** call adapters from commands, settings, panels, or managers.

**Internal flexibility:** HTTP format, auth, provider-specific language mapping,
and response parsing can change without affecting UI.

## ImmersiveTranslationManager

**File:** `src/immersive/manager.ts`

**Purpose:** Manages immersive translation in rendered Markdown, including active
files, block collection, rendering, refresh, copy actions, and failure pausing.

Important public methods:

```ts
export class ImmersiveTranslationManager {
	register(): void;
	isActive(path: string): boolean;
	toggleActiveFile(): void;
	stopAll(): void;
	translateBlock(block: TranslationBlock, options?: {bypassCache?: boolean}): Promise<string>;
}
```

**Callers:** plugin lifecycle, commands/ribbon, rendered immersive controls.

**Do:** use `plugin.immersiveManager.toggleActiveFile()` and `stopAll()`.

**Do not:** render immersive translation UI from unrelated modules.

**Internal flexibility:** rendered block collection, wrapper placement, styling,
and failure policy can change.

**Concurrency/cache/retry:**

- Calls `plugin.translateService.translateWithCache()` for each block.
- Uses the shared `RequestQueueService` through `TranslateService`.
- Uses the shared translation cache through `TranslateService`; it does not
  inspect cache keys directly.
- Pauses after repeated failures to avoid flooding a broken provider.

## RequestQueueService

**File:** `src/translation/request-queue-service.ts`

**Purpose:** Shared queue primitive for real translation requests. It limits
request start rate, caps concurrency, coalesces duplicate in-flight work, and
applies timeout/retry behavior.

```ts
export interface RequestQueueOptions {
	rate: number;
	capacity: number;
	timeoutMs: number;
	maxRetries: number;
	baseRetryDelayMs: number;
}

export interface QueueTaskOptions {
	scheduleAt?: number;
	timeoutMs?: number;
	maxRetries?: number;
}

export interface RequestQueueStats {
	pending: number;
	active: number;
	duplicates: number;
}

export interface RequestQueueService {
	enqueue<T>(key: string, run: () => Promise<T>, options?: QueueTaskOptions): Promise<T>;
	updateOptions(options: Partial<RequestQueueOptions>): void;
	clear(reason?: unknown): void;
	getStats(): RequestQueueStats;
}
```

**Callers:** `TranslateService.translateWithCache()`. UI reads `getStats()` for
the dashboard.

**Behavior:**

- `capacity` limits concurrent active tasks.
- `rate` limits how often tasks start.
- `timeoutMs` wraps each queued task.
- `maxRetries` retries failed tasks with exponential backoff.
- duplicate in-flight keys share the same promise.
- fatal status codes clear pending work to avoid repeatedly hammering a broken
  provider or invalid configuration.

**Do:** tune it through settings that are passed from `TranslateService`.

**Do not:** enqueue provider tests or model list calls here unless their UX is
explicitly designed around the translation queue.

## DocumentTranslationService

**File:** `src/document/document-translation-service.ts`

**Purpose:** Facade for Markdown file-level translation, side-by-side sessions,
translated file sync, restart recovery, and side-by-side toggling.

```ts
export interface DocumentTranslationService {
	openSideBySide(sourceFile: TFile): Promise<TFile>;
	toggleSideBySide(sourceFile: TFile): Promise<"opened" | "closed">;
	translateFile(sourceFile: TFile): Promise<TFile>;
	refresh(sourceFile: TFile): Promise<void>;
	isActive(sourcePath: string): boolean;
	getSourceFileForPath(path: string): TFile | null;
	stop(sourcePath: string): void;
	stopAll(): void;
	findLinkedTranslatedFile(sourceFile: TFile): Promise<TFile | null>;
	register(): void;
}
```

**Callers:** commands and ribbon menu. Commands should not directly call the
Markdown AST parser, sync store, or translated file writer.

**Internal modules:**

- `MarkdownDocumentParser` parses Markdown blocks with `@lezer/markdown`.
- `TranslatedFileSyncStore` persists source/translated file links in plugin
  settings.
- `TranslatedFileSyncService` manages debounce, generation guards, file updates,
  and restart recovery for open side-by-side sessions.

**Concurrency/cache/retry:** document blocks are translated through
`TranslateService.translateWithCache()`, so they share cache, queue, retry, and
metrics with other translation flows.

## TranslationMetricsService

**File:** `src/translation/metrics.ts`

**Purpose:** In-memory runtime metrics for the dashboard. Metrics reset when the
plugin reloads.

```ts
export interface TranslationMetricsSnapshot {
	requests: number;
	successes: number;
	failures: number;
	cacheHits: number;
	cacheMisses: number;
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
	tokenSupported: boolean;
}
```

**Callers:** `TranslateService` records cache/request events; the dashboard reads
snapshots and can reset them.

**Internal flexibility:** provider-specific token extraction can change without
changing translation APIs.

## Current Concurrency Summary

| Area | Queue | Concurrency limit | Rate limit | Retry | Duplicate coalescing |
| --- | --- | --- | --- | --- | --- |
| `translateWithCache()` flows: selection, current paragraph, quick panel, immersive, side-by-side/current file, and test translation | Yes | `immersiveQueueCapacity` | `immersiveQueueRate` | queue `maxRetries` | Yes, by cache/queue key |
| `translate()` raw provider call | No | No | No | provider retry only | No |
| TTS | No | One active playback by stop-then-play | No | No | No |
| Provider test/model list | No | Button/UI level only | No | No | No |
| Translation cache | N/A | N/A | N/A | N/A | Cache hit avoids request |

## Calling Rules

- UI, commands, and settings should call `plugin.translateService`, not provider
  adapters.
- Prompt-related business should call `plugin.promptService`, not prompt pure
  functions directly.
- TTS-related business should call `plugin.ttsService`, not Web Speech/OpenAI/Azure
  internals.
- Normal translation flows should use `translateWithCache()` unless there is a
  clear reason to bypass cache.
- File-level Markdown translation should call `plugin.documentTranslationService`,
  not parser or sync internals.
- Provider adapters and low-level HTTP helpers are internal implementation
  details.

## Later Discussion Points

These are not implemented yet:

- Decide whether TTS, provider tests, and model listing should opt into a shared
  or separate request queue.
- Add optional block-level merge behavior for user-edited translated Markdown
  files.
- Add tests around table cells, callout body text, list nesting, code/math skips,
  document sync recovery, and queue duplicate coalescing.
