export class TranslationError extends Error {
	constructor(message: string, readonly cause?: unknown) {
		super(message);
		this.name = "TranslationError";
	}
}

export function formatTranslationError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);

	if (/^Missing .+\.$/.test(message)) {
		return `Missing API configuration: ${message}`;
	}

	if (/timed out/i.test(message)) {
		return `Network timeout: ${message}`;
	}

	if (/HTTP \d+/.test(message)) {
		return `Provider request failed: ${message}`;
	}

	if (/not implemented/i.test(message)) {
		return `Provider unavailable: ${message}`;
	}

	if (/empty translation/i.test(message)) {
		return `Provider returned no translation: ${message}`;
	}

	if (/network|fetch|request/i.test(message)) {
		return `Network request failed: ${message}`;
	}

	return `Translation failed: ${message}`;
}

export function isTranslationError(error: unknown): error is TranslationError {
	return error instanceof TranslationError;
}

export function requireSetting(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) {
		throw new TranslationError(`Missing ${label}.`);
	}
	return trimmed;
}
