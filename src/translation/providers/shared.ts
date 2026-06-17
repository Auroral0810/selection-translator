import {TranslationError} from "../errors";
import type {TranslateRequest, TranslationProviderConfig} from "../types";

export interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
		finish_reason?: string;
	}>;
}

export function assertNotTruncated(label: string, reason: string | undefined): void {
	if (reason === "length" || reason === "max_tokens" || reason === "MAX_TOKENS") {
		throw new TranslationError(`${label} output was truncated by max output tokens. Increase Max output tokens and try again.`);
	}
}

export function getMaxOutputTokens(config: TranslationProviderConfig): number | undefined {
	const value = Number(config.maxOutputTokens);
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
}

export function getProviderConfig(request: TranslateRequest): TranslationProviderConfig {
	if (!request.providerConfig) {
		throw new TranslationError("No provider config was selected.");
	}
	return request.providerConfig;
}

export function getSystemPrompt(request: TranslateRequest): string {
	return getBuiltPrompt(request).systemPrompt;
}

export function createUserPrompt(request: TranslateRequest): string {
	return getBuiltPrompt(request).userPrompt;
}

function getBuiltPrompt(request: TranslateRequest) {
	if (!request.builtPrompt) {
		throw new TranslationError("No translation prompt was built for the request.");
	}
	return request.builtPrompt;
}
