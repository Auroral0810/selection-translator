import type {TranslateResult} from "./types";

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

export class TranslationMetricsService {
	private snapshot: TranslationMetricsSnapshot = createEmptySnapshot();

	getSnapshot(): TranslationMetricsSnapshot {
		return {...this.snapshot};
	}

	reset(): void {
		this.snapshot = createEmptySnapshot();
	}

	recordCacheHit(): void {
		this.snapshot.cacheHits++;
	}

	recordCacheMiss(): void {
		this.snapshot.cacheMisses++;
	}

	recordRequestStart(): void {
		this.snapshot.requests++;
	}

	recordSuccess(result: TranslateResult): void {
		this.snapshot.successes++;
		this.recordUsage(result.raw);
	}

	recordFailure(): void {
		this.snapshot.failures++;
	}

	private recordUsage(raw: unknown): void {
		const usage = extractUsage(raw);
		if (!usage) {
			return;
		}

		this.snapshot.tokenSupported = true;
		this.snapshot.inputTokens += usage.inputTokens;
		this.snapshot.outputTokens += usage.outputTokens;
		this.snapshot.totalTokens += usage.totalTokens || usage.inputTokens + usage.outputTokens;
	}
}

interface NormalizedUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

function createEmptySnapshot(): TranslationMetricsSnapshot {
	return {
		requests: 0,
		successes: 0,
		failures: 0,
		cacheHits: 0,
		cacheMisses: 0,
		inputTokens: 0,
		outputTokens: 0,
		totalTokens: 0,
		tokenSupported: false,
	};
}

function extractUsage(raw: unknown): NormalizedUsage | null {
	if (!isRecord(raw)) {
		return null;
	}

	const usage = raw.usage;
	if (isRecord(usage)) {
		const inputTokens = readNumber(usage.prompt_tokens) ?? readNumber(usage.input_tokens) ?? 0;
		const outputTokens = readNumber(usage.completion_tokens) ?? readNumber(usage.output_tokens) ?? 0;
		const totalTokens = readNumber(usage.total_tokens) ?? inputTokens + outputTokens;
		if (inputTokens > 0 || outputTokens > 0 || totalTokens > 0) {
			return {inputTokens, outputTokens, totalTokens};
		}
	}

	const usageMetadata = raw.usageMetadata;
	if (isRecord(usageMetadata)) {
		const inputTokens = readNumber(usageMetadata.promptTokenCount) ?? 0;
		const outputTokens = readNumber(usageMetadata.candidatesTokenCount) ?? 0;
		const totalTokens = readNumber(usageMetadata.totalTokenCount) ?? inputTokens + outputTokens;
		if (inputTokens > 0 || outputTokens > 0 || totalTokens > 0) {
			return {inputTokens, outputTokens, totalTokens};
		}
	}

	const promptEvalCount = readNumber(raw.prompt_eval_count) ?? 0;
	const evalCount = readNumber(raw.eval_count) ?? 0;
	if (promptEvalCount > 0 || evalCount > 0) {
		return {
			inputTokens: promptEvalCount,
			outputTokens: evalCount,
			totalTokens: promptEvalCount + evalCount,
		};
	}

	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function readNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}
