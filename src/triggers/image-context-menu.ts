import {Editor, MarkdownFileInfo, MarkdownView, Menu, TAbstractFile, TFile, WorkspaceLeaf} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import {openTranslateImageModal} from "../image/image-actions";
import {
	ImageReferenceContext,
	isSupportedImageFile,
	resolveImageContextFromEditor,
	resolveImageContextFromNoteFile,
	resolveImageContextFromReadingDom,
} from "../image/image-tools";

export function registerImageContextMenus(plugin: TranslationPlugin): void {
	plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile, source: string, leaf?: WorkspaceLeaf) => {
		if (!(file instanceof TFile) || !isSupportedImageFile(file) || isFileExplorerMenuSource(source)) {
			return;
		}

		void resolveImageContextFromNoteFile(plugin, file, getMarkdownFileFromLeaf(plugin, leaf)).then(context => {
			if (context) {
				addImageMenuItems(plugin, menu, context);
			}
		});
	}));

	plugin.registerEvent(plugin.app.workspace.on("editor-menu", (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
		const context = resolveImageContextFromEditor(plugin, editor, info);
		if (context) {
			menu.addSeparator();
			addImageMenuItems(plugin, menu, context);
		}
	}));

	plugin.registerDomEvent(activeDocument, "contextmenu", event => {
		const context = resolveImageContextFromReadingDom(plugin, event);
		if (!context) {
			return;
		}

		const menu = new Menu();
		addImageMenuItems(plugin, menu, context);
		event.preventDefault();
		menu.showAtMouseEvent(event);
	});
}

function addImageMenuItems(plugin: TranslationPlugin, menu: Menu, target: ImageReferenceContext): void {
	if (!plugin.settings.enableImageTools) {
		return;
	}
	if (!target.sourceFile) {
		return;
	}

	menu.addItem(item => item
		.setTitle(t(plugin, "image.menu.insertBelow"))
		.setIcon("image-plus")
		.onClick(() => {
			openTranslateImageModal(plugin, target, "insert-below");
		}));

	menu.addItem(item => item
		.setTitle(t(plugin, "image.menu.replace"))
		.setIcon("replace")
		.onClick(() => {
			openTranslateImageModal(plugin, target, "replace-reference");
		}));
}

function getMarkdownFileFromLeaf(plugin: TranslationPlugin, leaf?: WorkspaceLeaf): TFile | null {
	const view = leaf?.view;
	if (view instanceof MarkdownView && view.file) {
		return view.file;
	}

	return plugin.app.workspace.getActiveFile();
}

function isFileExplorerMenuSource(source: string): boolean {
	const normalized = source.toLowerCase();
	return normalized.includes("file-explorer") || normalized.includes("file explorer") || normalized.includes("files-menu");
}
