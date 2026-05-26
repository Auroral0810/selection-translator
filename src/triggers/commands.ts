import TranslationPlugin from "../main";
import {openSideBySideTranslation} from "../actions/open-side-by-side-translation";
import {toggleImmersiveTranslation} from "../actions/toggle-immersive-translation";
import {translateCurrentFile} from "../actions/translate-current-file";
import {translateCurrentParagraph, translateCurrentParagraphAndInsertBelow} from "../actions/translate-current-paragraph";
import {getActiveMarkdownView, translateSelection} from "../actions/translate-selection";
import {showQuickTranslationPanel} from "../ui/quick-translation-panel";
import {t} from "../i18n";

export function registerTranslationCommands(plugin: TranslationPlugin) {
	plugin.addCommand({
		id: "translate-selection",
		name: t(plugin, "command.translateSelection"),
		checkCallback: (checking: boolean) => {
			const markdownView = getActiveMarkdownView(plugin);

			if (!markdownView) {
				return false;
			}

			if (!checking) {
				void translateSelection(plugin, markdownView.editor);
			}

			return true;
		},
	});

	plugin.addCommand({
		id: "open-quick-translation-panel",
		name: t(plugin, "command.openQuickPanel"),
		callback: () => {
			const markdownView = getActiveMarkdownView(plugin);
			showQuickTranslationPanel(plugin, {
				initialText: markdownView?.editor.getSelection().trim() ?? "",
			});
		},
	});

	plugin.addCommand({
		id: "translate-current-paragraph",
		name: t(plugin, "command.translateCurrentParagraph"),
		checkCallback: (checking: boolean) => {
			const markdownView = getActiveMarkdownView(plugin);

			if (!markdownView) {
				return false;
			}

			if (!checking) {
				void translateCurrentParagraph(plugin, markdownView.editor);
			}

			return true;
		},
	});

	plugin.addCommand({
		id: "translate-current-paragraph-insert-below",
		name: t(plugin, "command.translateParagraphInsertBelow"),
		checkCallback: (checking: boolean) => {
			const markdownView = getActiveMarkdownView(plugin);

			if (!markdownView) {
				return false;
			}

			if (!checking) {
				void translateCurrentParagraphAndInsertBelow(plugin, markdownView.editor);
			}

			return true;
		},
	});

	plugin.addCommand({
		id: "translate-current-file",
		name: t(plugin, "command.translateCurrentFile"),
		callback: () => {
			void translateCurrentFile(plugin);
		},
	});

	plugin.addCommand({
		id: "toggle-immersive-translation",
		name: t(plugin, "command.toggleImmersive"),
		callback: () => toggleImmersiveTranslation(plugin),
	});

	plugin.addCommand({
		id: "open-side-by-side-translation",
		name: t(plugin, "command.openSideBySide"),
		callback: () => {
			void openSideBySideTranslation(plugin);
		},
	});

	plugin.addCommand({
		id: "toggle-two-pane-scroll-sync",
		name: t(plugin, "command.toggleScrollSync"),
		callback: () => plugin.sideBySideSyncManager.toggleForVisibleMarkdownLeaves(),
	});
}
