import {TranslationError} from "../errors";
import type {TranslateRequest, TranslationProviderConfig} from "../types";

export interface ChatCompletionResponse {
	choices?: Array<{
		message?: {
			content?: string;
		};
	}>;
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
