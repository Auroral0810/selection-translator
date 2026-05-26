import {requestUrl, RequestUrlParam} from "obsidian";
import {isTranslationError, TranslationError} from "./errors";

interface JsonRequestOptions {
	url: string;
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	timeoutMs: number;
}

export async function requestJson<T>(options: JsonRequestOptions): Promise<T> {
	const response = await requestRaw(options);

	if (response.status < 200 || response.status >= 300) {
		throw new TranslationError(`Request failed with HTTP ${response.status}: ${response.text}`);
	}

	try {
		return response.json as T;
	} catch (error) {
		throw new TranslationError("Failed to parse translation response.", error);
	}
}

export async function requestText(options: JsonRequestOptions): Promise<string> {
	const response = await requestRaw(options);
	if (response.status < 200 || response.status >= 300) {
		throw new TranslationError(`Request failed with HTTP ${response.status}: ${response.text}`);
	}
	return response.text;
}

async function requestRaw(options: JsonRequestOptions) {
	try {
		return await withTimeout(requestUrl({
			url: options.url,
			method: options.method ?? "GET",
			headers: options.headers,
			body: options.body,
		} satisfies RequestUrlParam), options.timeoutMs);
	} catch (error) {
		if (isTranslationError(error)) {
			throw error;
		}

		throw new TranslationError(error instanceof Error ? `Network request failed: ${error.message}` : "Network request failed.", error);
	}
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timeoutId: number | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timeoutId = window.setTimeout(() => {
			reject(new TranslationError(`Request timed out after ${timeoutMs} ms.`));
		}, timeoutMs);
	});

	try {
		return await Promise.race([promise, timeout]);
	} finally {
		if (timeoutId !== undefined) {
			window.clearTimeout(timeoutId);
		}
	}
}

export async function retry<T>(attempts: number, task: () => Promise<T>): Promise<T> {
	let lastError: unknown;
	const totalAttempts = Math.max(1, attempts);

	for (let attempt = 0; attempt < totalAttempts; attempt++) {
		try {
			return await task();
		} catch (error) {
			lastError = error;
		}
	}

	throw lastError;
}
