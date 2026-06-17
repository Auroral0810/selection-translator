import {Editor, Notice} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import {isTranslatableMarkdownText} from "../translation/text-filter";
import {startCommandNotice} from "../ui/command-notice";
import {PanelAnchorPoint, showTranslationPanel} from "../ui/translation-panel";

interface EditorViewLike {
	coordsAtPos(pos: number, side?: -1 | 1): DOMRect | null;
}

interface CodeMirrorBackedEditor {
	cm?: EditorViewLike;
}

interface CurrentParagraph {
	text: string;
	fromLine: number;
	toLine: number;
}

export async function translateCurrentParagraph(plugin: TranslationPlugin, editor: Editor): Promise<void> {
	const paragraph = getCurrentParagraph(editor);

	if (!paragraph) {
		new Notice(t(plugin, "notice.noParagraph"));
		return;
	}

	if (!isTranslatableParagraph(paragraph.text)) {
		new Notice(t(plugin, "notice.notTranslatableParagraph"));
		return;
	}

	const notice = startCommandNotice({
		plugin,
		title: t(plugin, "command.translateCurrentParagraph"),
		message: t(plugin, "quick.translating"),
	});

	try {
		const result = await plugin.translateService.translateWithCache({
			text: paragraph.text,
			sourceLanguage: plugin.settings.sourceLanguage,
			targetLanguage: plugin.settings.targetLanguage,
			settings: plugin.settings,
		});

		showTranslationPanel(plugin, {
			sourceText: paragraph.text,
			translatedText: result.text,
			showSourceText: plugin.settings.showSourceText,
			anchorPoint: getCursorAnchorPoint(editor),
		});
		notice.success(t(plugin, "notice.translationCompleted"));
	} catch (error) {
		console.error("Failed to translate current paragraph", error);
		notice.fail(error, {
			commandName: t(plugin, "command.translateCurrentParagraph"),
			text: paragraph.text,
		});
	}
}

export async function translateCurrentParagraphAndInsertBelow(plugin: TranslationPlugin, editor: Editor): Promise<void> {
	const paragraph = getCurrentParagraph(editor);

	if (!paragraph) {
		new Notice(t(plugin, "notice.noParagraph"));
		return;
	}

	if (!isTranslatableParagraph(paragraph.text)) {
		new Notice(t(plugin, "notice.notTranslatableParagraph"));
		return;
	}

	const notice = startCommandNotice({
		plugin,
		title: t(plugin, "command.translateParagraphInsertBelow"),
		message: t(plugin, "quick.translating"),
	});

	try {
		const result = await plugin.translateService.translateWithCache({
			text: paragraph.text,
			sourceLanguage: plugin.settings.sourceLanguage,
			targetLanguage: plugin.settings.targetLanguage,
			settings: plugin.settings,
		});

		const insertLine = paragraph.toLine;
		const insertCh = editor.getLine(insertLine).length;
		editor.replaceRange(`\n\n${toBlockquote(result.text)}`, {
			line: insertLine,
			ch: insertCh,
		});
		notice.success(t(plugin, "notice.translationInsertedBelow"));
	} catch (error) {
		console.error("Failed to translate and insert current paragraph", error);
		notice.fail(error, {
			commandName: t(plugin, "command.translateParagraphInsertBelow"),
			text: paragraph.text,
		});
	}
}

function getCurrentParagraph(editor: Editor): CurrentParagraph | null {
	const lineCount = editor.lineCount();
	if (lineCount === 0) {
		return null;
	}

	let line = editor.getCursor().line;
	// Ensure line is within valid bounds
	if (line < 0 || line >= lineCount) {
		return null;
	}
	line = Math.min(line, lineCount - 1);

	if (!editor.getLine(line).trim()) {
		const nearbyLine = findNearbyNonEmptyLine(editor, line);
		if (nearbyLine === null) {
			return null;
		}
		line = nearbyLine;
	}

	let fromLine = line;
	while (fromLine > 0 && editor.getLine(fromLine - 1).trim()) {
		fromLine--;
	}

	let toLine = line;
	while (toLine < lineCount - 1 && editor.getLine(toLine + 1).trim()) {
		toLine++;
	}

	const text = Array.from({length: toLine - fromLine + 1}, (_, index) => editor.getLine(fromLine + index)).join("\n").trim();
	if (!text) {
		return null;
	}

	return {
		text,
		fromLine,
		toLine,
	};
}

function findNearbyNonEmptyLine(editor: Editor, line: number): number | null {
	for (let offset = 1; offset <= 3; offset++) {
		const previous = line - offset;
		if (previous >= 0 && editor.getLine(previous).trim()) {
			return previous;
		}
		const next = line + offset;
		if (next < editor.lineCount() && editor.getLine(next).trim()) {
			return next;
		}
	}
	return null;
}

function getCursorAnchorPoint(editor: Editor): PanelAnchorPoint | null {
	const editorView = (editor as CodeMirrorBackedEditor).cm;
	if (!editorView) {
		return null;
	}
	const cursor = editor.getCursor();
	const offset = editor.posToOffset(cursor);
	const rect = editorView.coordsAtPos(offset, 1);
	if (!rect) {
		return null;
	}
	return {
		x: rect.right,
		y: rect.bottom,
	};
}

function isTranslatableParagraph(text: string): boolean {
	return isTranslatableMarkdownText(text);
}

function toBlockquote(text: string): string {
	return text
		.split(/\r?\n/)
		.map(line => `> ${line}`)
		.join("\n");
}
