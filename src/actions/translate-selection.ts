import {Editor, MarkdownView, Notice} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import {startCommandNotice} from "../ui/command-notice";
import {PanelAnchorPoint, showTranslationPanel} from "../ui/translation-panel";

interface EditorViewLike {
	coordsAtPos(pos: number, side?: -1 | 1): DOMRect | null;
}

interface CodeMirrorBackedEditor {
	cm?: EditorViewLike;
}

export async function translateSelection(plugin: TranslationPlugin, editor: Editor): Promise<void> {
	const selectedText = editor.getSelection().trim();
	const anchorPoint = getSelectionAnchorPoint(editor);

	if (!selectedText) {
		new Notice(t(plugin, "notice.selectText"));
		return;
	}

	const notice = startCommandNotice({
		plugin,
		title: t(plugin, "command.translateSelection"),
		message: t(plugin, "quick.translating"),
	});

	try {
		const result = await plugin.translateService.translateWithCache({
			text: selectedText,
			sourceLanguage: plugin.settings.sourceLanguage,
			targetLanguage: plugin.settings.targetLanguage,
			settings: plugin.settings,
		});

		showTranslationPanel(plugin, {
			sourceText: selectedText,
			translatedText: result.text,
			showSourceText: plugin.settings.showSourceText,
			anchorPoint,
		});
		notice.success(t(plugin, "settings.api.testSuccess"));
	} catch (error) {
		console.error("Failed to translate selection", error);
		notice.fail(error, {
			commandName: t(plugin, "command.translateSelection"),
			text: selectedText,
		});
	}
}

export function getActiveMarkdownView(plugin: TranslationPlugin): MarkdownView | null {
	return plugin.app.workspace.getActiveViewOfType(MarkdownView);
}

function getSelectionAnchorPoint(editor: Editor): PanelAnchorPoint | null {
	const editorView = (editor as CodeMirrorBackedEditor).cm;

	if (!editorView) {
		return null;
	}

	const selectionEnd = editor.getCursor("to");
	const selectionStart = editor.getCursor("from");
	const endOffset = editor.posToOffset(selectionEnd);
	const startOffset = editor.posToOffset(selectionStart);
	const rect = editorView.coordsAtPos(endOffset, 1) ?? editorView.coordsAtPos(startOffset, -1);

	if (!rect) {
		return null;
	}

	return {
		x: rect.right,
		y: rect.bottom,
	};
}
