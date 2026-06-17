const CJK_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const LETTER_PATTERN = /\p{Letter}/gu;
const NUMBER_PATTERN = /\p{Number}/gu;
const SYMBOL_PATTERN = /[^\p{Letter}\p{Number}\s]/gu;

export function isTranslatableMarkdownText(text: string): boolean {
	const normalized = normalizeMarkdownText(text);
	if (!normalized) {
		return false;
	}

	if (looksLikeCodeOrConfig(normalized) || looksLikePronunciationOrNotation(normalized)) {
		return false;
	}

	const cjkCount = countMatches(normalized, CJK_PATTERN);
	const letterCount = countMatches(normalized, LETTER_PATTERN);
	const numberCount = countMatches(normalized, NUMBER_PATTERN);
	const symbolCount = countMatches(normalized, SYMBOL_PATTERN);
	const compactLength = normalized.replace(/\s/g, "").length;

	if (letterCount === 0) {
		return false;
	}
	if (compactLength < 20 && cjkCount < 2) {
		return false;
	}
	if (symbolCount > letterCount + numberCount) {
		return false;
	}

	// Check letter density: at least 45% of non-whitespace characters should be letters
	// Handle edge case: if compactLength is 0, letterCount must also be 0 (already returned false above)
	if (compactLength === 0) {
		return false;
	}
	return letterCount / compactLength >= 0.45;
}

export function normalizeMarkdownText(text: string): string {
	return text
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`\n]*`/g, " ")
		.replace(/!\[[^\]]*]\([^)]*\)/g, " ")
		.replace(/\[[^\]]+]\([^)]*\)/g, match => match.replace(/^\[|\]\([^)]*\)$/g, ""))
		.replace(/^\s{0,3}#{1,6}\s+/gm, "")
		.replace(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+\.\s+)/gm, "")
		.replace(/^\s*(?:>\s*)+/gm, "")
		.replace(/^\s*\|?[:\-\s|]+\|?\s*$/gm, " ")
		.replace(/[|*_~[\]()#>]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function looksLikeCodeOrConfig(text: string): boolean {
	// Keep strong programming signals, but relax punctuation/URL heuristics that
	// commonly appear in normal prose (e.g. papers citing URLs, math like {x, y},
	// or sentences containing "=" / ":"). Real code blocks are already excluded by
	// the markdown AST (FencedCode/CodeBlock), so this filter is only a fallback.
	const isSingleLine = !text.includes("\n");
	return /\b(const|let|var|function|return|import|export|class|interface|type|new)\b/.test(text)
		|| /=>/.test(text)
		|| /\b(dv|this|window|document|container|console)\./.test(text)
		|| (isSingleLine && /^\s*[\w.-]+\s*[:=]\s*\S+$/.test(text));
}

function looksLikePronunciationOrNotation(text: string): boolean {
	const lines = text
		.split("\n")
		.map(line => line.trim())
		.filter(Boolean);

	if (lines.length === 0) {
		return false;
	}

	if (lines.every(line => /^\/[^/\n]{1,80}\/$/.test(line))) {
		return true;
	}

	const notationLength = Array.from(text.matchAll(/\/[^/\n]{1,80}\//g))
		.reduce((length, match) => length + match[0].length, 0);
	const compactLength = text.replace(/\s/g, "").length;

	// Handle edge case: empty or whitespace-only text
	if (compactLength === 0) {
		return false;
	}
	return notationLength > 0 && notationLength / compactLength >= 0.45;
}

function countMatches(text: string, pattern: RegExp): number {
	return Array.from(text.matchAll(pattern)).length;
}
