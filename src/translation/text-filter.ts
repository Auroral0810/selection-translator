const LETTER_PATTERN = /\p{Letter}/gu;

export function isTranslatableMarkdownText(text: string): boolean {
	const normalized = normalizeMarkdownText(text);
	if (!normalized) {
		return false;
	}

	const letterCount = countMatches(normalized, LETTER_PATTERN);
	return letterCount > 0;
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

function countMatches(text: string, pattern: RegExp): number {
	return Array.from(text.matchAll(pattern)).length;
}
