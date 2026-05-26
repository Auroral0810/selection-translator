export type ImmersiveMode = "bilingual" | "translation-only" | "hover" | "write";
export type ImmersiveStyle = "blockquote" | "weakened" | "border" | "background" | "custom";

export interface TranslationBlock {
	id: string;
	sourceText: string;
	filePath?: string;
	headingPath?: string[];
	startLine?: number;
	endLine?: number;
}

export type ImmersivePlacement = "after" | "inside";

export interface RenderedTranslationTarget {
	block: TranslationBlock;
	element: HTMLElement;
	placement: ImmersivePlacement;
	compact: boolean;
}
