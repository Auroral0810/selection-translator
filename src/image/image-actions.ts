import {Modal, Notice, Setting, TFile} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import {formatTranslationError} from "../translation/errors";
import {
	createAvailableSiblingFile,
	ImageReferenceContext,
	insertTranslatedImageBelow,
	replaceImageReference,
} from "./image-tools";
import {translateImageWithOpenAI} from "./openai-image";

export type ImageTranslationAction = "insert-below" | "replace-reference";

export function openTranslateImageModal(plugin: TranslationPlugin, target: ImageReferenceContext, action: ImageTranslationAction): void {
	new TranslateImageModal(plugin, target, action).open();
}

class TranslateImageModal extends Modal {
	private targetLanguage = this.plugin.settings.targetLanguage;
	private prompt = this.plugin.settings.imageTranslationPrompt;
	private outputFormat = this.plugin.settings.imageOutputFormat || "png";
	private readonly file: TFile;

	constructor(private readonly plugin: TranslationPlugin, private readonly referenceContext: ImageReferenceContext, private readonly action: ImageTranslationAction) {
		super(plugin.app);
		this.file = referenceContext.file;
	}

	onOpen(): void {
		this.contentEl.empty();
		this.titleEl.setText(getActionTitle(this.plugin, this.action));

		new Setting(this.contentEl)
			.setName(t(this.plugin, "image.modal.targetLanguage"))
			.setDesc(t(this.plugin, "image.modal.targetLanguageDesc"))
			.addText(text => text
				.setValue(this.targetLanguage)
				.onChange(value => {
					this.targetLanguage = value.trim() || this.plugin.settings.targetLanguage;
				}));

		new Setting(this.contentEl)
			.setName(t(this.plugin, "image.modal.prompt"))
			.setDesc(t(this.plugin, "image.modal.promptDesc"))
			.addTextArea(text => text
				.setValue(this.prompt)
				.onChange(value => {
					this.prompt = value;
				}));

		new Setting(this.contentEl)
			.setName(t(this.plugin, "image.modal.outputFormat"))
			.setDesc(t(this.plugin, "image.modal.outputFormatDesc"))
			.addText(text => text
				.setValue(this.outputFormat)
				.onChange(value => {
					this.outputFormat = value.trim() || "png";
				}));

		new Setting(this.contentEl)
			.addButton(button => button
				.setButtonText(getActionButtonText(this.plugin, this.action))
				.setCta()
				.onClick(() => {
					void this.translate(button.buttonEl);
				}))
			.addButton(button => button
				.setButtonText(t(this.plugin, "common.cancel"))
				.onClick(() => this.close()));
	}

	private async translate(button: HTMLButtonElement): Promise<void> {
		button.disabled = true;
		button.textContent = t(this.plugin, "quick.translating");

		// Show persistent loading notice
		const loadingNotice = new Notice(
			t(this.plugin, "image.modal.translating"),
			0 // Don't auto-hide
		);

		try {
			const imageData = await this.plugin.app.vault.readBinary(this.file);
			const translatedImage = await translateImageWithOpenAI(this.plugin, {
				imageData,
				fileName: this.file.name,
				targetLanguage: this.targetLanguage,
				prompt: this.prompt,
				outputFormat: this.outputFormat,
			});
			const outputFile = await createAvailableSiblingFile(this.plugin, this.file, `.translated.${this.targetLanguage}`, this.outputFormat, translatedImage);

			// Hide loading notice before showing success
			loadingNotice.hide();

			await this.applyAction(outputFile);
			this.close();
		} catch (error) {
			// Hide loading notice on error
			loadingNotice.hide();
			console.error("Failed to translate image", error);
			new Notice(formatTranslationError(error), 8000);
		} finally {
			button.disabled = false;
			button.textContent = getActionButtonText(this.plugin, this.action);
		}
	}

	private async applyAction(outputFile: TFile): Promise<void> {
		if (this.action === "insert-below") {
			await insertTranslatedImageBelow(this.plugin, this.referenceContext, outputFile);
			new Notice(t(this.plugin, "image.modal.inserted", {path: outputFile.path}));
			return;
		}

		await replaceImageReference(this.plugin, this.referenceContext, outputFile);
		new Notice(t(this.plugin, "image.modal.replaced", {path: outputFile.path}));
	}
}

function getActionTitle(plugin: TranslationPlugin, action: ImageTranslationAction): string {
	if (action === "insert-below") {
		return t(plugin, "image.menu.insertBelow");
	}
	return t(plugin, "image.menu.replace");
}

function getActionButtonText(plugin: TranslationPlugin, action: ImageTranslationAction): string {
	if (action === "insert-below") {
		return t(plugin, "image.modal.translateInsert");
	}
	return t(plugin, "image.modal.translateReplace");
}
