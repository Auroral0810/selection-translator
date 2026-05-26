import {MarkdownView, Notice, WorkspaceLeaf} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import {isHTMLElement} from "../ui/dom";

interface PercentageSyncSession {
	leftLeaf: WorkspaceLeaf;
	rightLeaf: WorkspaceLeaf;
	cleanup: Array<() => void>;
	animationFrame: number | null;
	pendingFromScroller: HTMLElement | null;
	pendingToScroller: HTMLElement | null;
	programmaticScroller: HTMLElement | null;
	programmaticUntil: number;
}

export class SideBySideSyncManager {
	private session: PercentageSyncSession | null = null;
	private validationTimer: number | null = null;
	private readonly scrollCandidateSelectors = [
		".cm-scroller",
		".markdown-preview-view",
		".markdown-reading-view",
		".markdown-source-view",
		".view-content",
		".workspace-leaf-content",
	];

	constructor(private readonly plugin: TranslationPlugin) {}

	register(): void {
		const scheduleValidation = () => this.scheduleSessionValidation();
		this.plugin.registerEvent(this.plugin.app.workspace.on("layout-change", scheduleValidation));
		this.plugin.registerEvent(this.plugin.app.workspace.on("active-leaf-change", scheduleValidation));
		this.plugin.registerEvent(this.plugin.app.workspace.on("file-open", scheduleValidation));
	}

	isEnabled(): boolean {
		return this.validateSession();
	}

	toggleForVisibleMarkdownLeaves(): void {
		if (this.validateSession()) {
			this.disable();
			new Notice(t(this.plugin, "scroll.disabled"));
			return;
		}

		const leaves = this.getMarkdownLeaves();
		if (leaves.length < 2) {
			new Notice(t(this.plugin, "scroll.needTwoPanes"));
			return;
		}

		const activeLeaf = this.plugin.app.workspace.getLeaf(false);
		const leftLeaf = activeLeaf && this.isMarkdownLeaf(activeLeaf) ? activeLeaf : leaves[0];
		const rightLeaf = leaves.find(leaf => leaf !== leftLeaf);
		if (!leftLeaf || !rightLeaf) {
			new Notice(t(this.plugin, "scroll.needTwoPanes"));
			return;
		}

		this.enableForLeaves(leftLeaf, rightLeaf);
	}

	enableForLeaves(leftLeaf: WorkspaceLeaf, rightLeaf: WorkspaceLeaf): void {
		if (leftLeaf === rightLeaf) {
			return;
		}

		this.disable();
		const session: PercentageSyncSession = {
			leftLeaf,
			rightLeaf,
			cleanup: [],
			animationFrame: null,
			pendingFromScroller: null,
			pendingToScroller: null,
			programmaticScroller: null,
			programmaticUntil: 0,
		};
		this.session = session;

		window.setTimeout(() => this.attachScrollListenersWithRetry(session, 0), 150);
	}

	disable(): void {
		if (!this.session) {
			return;
		}

		for (const cleanup of this.session.cleanup) {
			cleanup();
		}
		if (this.session.animationFrame !== null) {
			window.cancelAnimationFrame(this.session.animationFrame);
		}
		this.session = null;
	}

	closeAll(): void {
		if (this.validationTimer !== null) {
			window.clearTimeout(this.validationTimer);
			this.validationTimer = null;
		}
		this.disable();
	}

	private scheduleSessionValidation(): void {
		if (!this.session) {
			return;
		}

		if (this.validationTimer !== null) {
			window.clearTimeout(this.validationTimer);
		}

		this.validationTimer = window.setTimeout(() => {
			this.validationTimer = null;
			this.validateSession();
		}, 100);
	}

	private validateSession(): boolean {
		const session = this.session;
		if (!session) {
			return false;
		}

		if (session.leftLeaf === session.rightLeaf
			|| !this.isMarkdownLeaf(session.leftLeaf)
			|| !this.isMarkdownLeaf(session.rightLeaf)
			|| !this.findBestScrollableElement(session.leftLeaf)
			|| !this.findBestScrollableElement(session.rightLeaf)) {
			this.disable();
			return false;
		}

		return true;
	}

	private attachScrollListenersWithRetry(session: PercentageSyncSession, attempt: number): void {
		if (this.session !== session) {
			return;
		}

		if (!this.isMarkdownLeaf(session.leftLeaf) || !this.isMarkdownLeaf(session.rightLeaf)) {
			this.disable();
			new Notice(t(this.plugin, "scroll.stoppedNotMarkdown"));
			return;
		}

		const leftScroller = this.findBestScrollableElement(session.leftLeaf);
		const rightScroller = this.findBestScrollableElement(session.rightLeaf);
		if (!leftScroller || !rightScroller) {
			if (attempt < 6) {
				window.setTimeout(() => this.attachScrollListenersWithRetry(session, attempt + 1), 150 + attempt * 150);
				return;
			}

			this.disable();
			new Notice(t(this.plugin, "scroll.noScrollable"));
			return;
		}

		const onLeftScroll = (event?: Event) => this.scheduleSyncFromEvent(session, event, session.leftLeaf, session.rightLeaf);
		const onRightScroll = (event?: Event) => this.scheduleSyncFromEvent(session, event, session.rightLeaf, session.leftLeaf);
		leftScroller.addEventListener("scroll", onLeftScroll, {passive: true});
		rightScroller.addEventListener("scroll", onRightScroll, {passive: true});
		session.cleanup.push(() => leftScroller.removeEventListener("scroll", onLeftScroll));
		session.cleanup.push(() => rightScroller.removeEventListener("scroll", onRightScroll));

		const leftContainer = this.getLeafContainer(session.leftLeaf);
		const rightContainer = this.getLeafContainer(session.rightLeaf);
		if (leftContainer) {
			leftContainer.addEventListener("scroll", onLeftScroll, {capture: true, passive: true});
			session.cleanup.push(() => leftContainer.removeEventListener("scroll", onLeftScroll, {capture: true}));
		}
		if (rightContainer) {
			rightContainer.addEventListener("scroll", onRightScroll, {capture: true, passive: true});
			session.cleanup.push(() => rightContainer.removeEventListener("scroll", onRightScroll, {capture: true}));
		}

		new Notice(t(this.plugin, "scroll.enabled"));
	}

	private scheduleSyncFromEvent(
		session: PercentageSyncSession,
		event: Event | undefined,
		fromLeaf: WorkspaceLeaf,
		toLeaf: WorkspaceLeaf
	): void {
		const eventScroller = this.getEventScrollableElement(event);
		if (eventScroller && !this.isLeafScroller(fromLeaf, eventScroller)) {
			return;
		}

		const fromScroller = eventScroller ?? this.findBestScrollableElement(fromLeaf);
		const toScroller = this.findBestScrollableElement(toLeaf);
		if (!fromScroller || !toScroller || fromScroller === toScroller) {
			return;
		}

		this.scheduleSync(session, fromScroller, toScroller);
	}

	private scheduleSync(session: PercentageSyncSession, fromScroller: HTMLElement, toScroller: HTMLElement): void {
		if (this.session !== session) {
			return;
		}

		const now = performance.now();
		if (fromScroller === session.programmaticScroller && now < session.programmaticUntil) {
			return;
		}

		session.pendingFromScroller = fromScroller;
		session.pendingToScroller = toScroller;

		if (session.animationFrame !== null) {
			return;
		}

		session.animationFrame = window.requestAnimationFrame(() => {
			session.animationFrame = null;
			const pendingFromScroller = session.pendingFromScroller;
			const pendingToScroller = session.pendingToScroller;
			session.pendingFromScroller = null;
			session.pendingToScroller = null;

			if (!pendingFromScroller || !pendingToScroller || this.session !== session) {
				return;
			}

			this.syncByPercentage(session, pendingFromScroller, pendingToScroller);
		});
	}

	private syncByPercentage(session: PercentageSyncSession, fromScroller: HTMLElement, toScroller: HTMLElement): void {
		const fromMax = Math.max(1, fromScroller.scrollHeight - fromScroller.clientHeight);
		const toMax = Math.max(0, toScroller.scrollHeight - toScroller.clientHeight);
		const targetScrollTop = toMax * (fromScroller.scrollTop / fromMax);
		if (Math.abs(toScroller.scrollTop - targetScrollTop) < 1) {
			return;
		}

		session.programmaticScroller = toScroller;
		session.programmaticUntil = performance.now() + 80;
		toScroller.scrollTop = targetScrollTop;
	}

	private getMarkdownLeaves(): WorkspaceLeaf[] {
		return this.plugin.app.workspace.getLeavesOfType("markdown").filter(leaf => this.isMarkdownLeaf(leaf));
	}

	private isMarkdownLeaf(leaf: WorkspaceLeaf): boolean {
		return leaf.view instanceof MarkdownView;
	}

	private findBestScrollableElement(leaf: WorkspaceLeaf): HTMLElement | null {
		const view = leaf.view;
		if (!(view instanceof MarkdownView)) {
			return null;
		}

		const candidates = new Set<HTMLElement>();
		for (const selector of this.scrollCandidateSelectors) {
			for (const element of Array.from(view.containerEl.querySelectorAll<HTMLElement>(selector))) {
				candidates.add(element);
			}
		}
		candidates.add(view.containerEl);

		let best: HTMLElement | null = null;
		let bestRange = 0;
		for (const candidate of candidates) {
			const range = this.getScrollRange(candidate);
			if (range > bestRange) {
				best = candidate;
				bestRange = range;
			}
		}

		return best;
	}

	private getLeafContainer(leaf: WorkspaceLeaf): HTMLElement | null {
		return leaf.view instanceof MarkdownView ? leaf.view.containerEl : null;
	}

	private getEventScrollableElement(event: Event | undefined): HTMLElement | null {
		const target = event?.target ?? null;
		if (!isHTMLElement(target)) {
			return null;
		}

		return this.getScrollRange(target) > 0 ? target : null;
	}

	private isLeafScroller(leaf: WorkspaceLeaf, scroller: HTMLElement): boolean {
		const container = this.getLeafContainer(leaf);
		return container?.contains(scroller) ?? false;
	}

	private getScrollRange(element: HTMLElement): number {
		return Math.max(0, element.scrollHeight - element.clientHeight - 4);
	}
}
