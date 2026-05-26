import {Notice} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";

type TaskLogStatus = "running" | "success" | "failed" | "cancelled";

interface TaskToastEntry {
	title: string;
	status: TaskLogStatus;
	notice: Notice;
	lines: string[];
	hideTimer: number | null;
}

const TASK_TOAST_MAX_LINES = 20;
const RUNNING_NOTICE_DURATION_MS = 30000;
const SUCCESS_NOTICE_DURATION_MS = 5000;
const FAILURE_NOTICE_DURATION_MS = 8000;

export class TaskLogManager {
	private readonly tasks = new Map<string, TaskToastEntry>();
	private nextId = 1;

	constructor(private readonly plugin: TranslationPlugin) {}

	startTask(title: string): string {
		const id = `task-${this.nextId++}`;
		const notice = new Notice(this.formatMessage(title, "running", "Starting..."), RUNNING_NOTICE_DURATION_MS);
		this.tasks.set(id, {
			title,
			status: "running",
			notice,
			lines: [],
			hideTimer: null,
		});
		this.scheduleHide(id, RUNNING_NOTICE_DURATION_MS);
		return id;
	}

	append(taskId: string, text: string): void {
		const task = this.tasks.get(taskId);
		if (!task) {
			return;
		}

		task.lines.push(text);
		if (task.lines.length > TASK_TOAST_MAX_LINES) {
			task.lines.splice(0, task.lines.length - TASK_TOAST_MAX_LINES);
		}
		task.notice.setMessage(this.formatMessage(task.title, task.status, this.getLatestLine(task)));
	}

	complete(taskId: string, message = "Done."): void {
		this.finish(taskId, "success", message);
		this.scheduleHide(taskId, SUCCESS_NOTICE_DURATION_MS);
	}

	fail(taskId: string, message = "Task failed."): void {
		this.finish(taskId, "failed", message);
		this.scheduleHide(taskId, FAILURE_NOTICE_DURATION_MS);
	}

	cancel(taskId: string, message = "Task cancelled."): void {
		this.finish(taskId, "cancelled", message);
		this.scheduleHide(taskId, FAILURE_NOTICE_DURATION_MS);
	}

	show(): void {
		new Notice(t(this.plugin, "notice.taskUpdatesAsNotices"), 4000);
	}

	hide(): void {}

	toggle(): void {
		this.show();
	}

	close(): void {
		for (const taskId of Array.from(this.tasks.keys())) {
			this.hideTask(taskId);
		}
	}

	private finish(taskId: string, status: TaskLogStatus, message: string): void {
		const task = this.tasks.get(taskId);
		if (!task) {
			return;
		}

		task.status = status;
		task.lines.push(message);
		task.notice.setMessage(this.formatMessage(task.title, status, message));
	}

	private scheduleHide(taskId: string, durationMs: number): void {
		const task = this.tasks.get(taskId);
		if (!task) {
			return;
		}
		this.clearTaskTimer(task);
		task.hideTimer = window.setTimeout(() => this.hideTask(taskId), durationMs);
	}

	private clearTaskTimer(task: TaskToastEntry): void {
		if (task.hideTimer === null) {
			return;
		}
		window.clearTimeout(task.hideTimer);
		task.hideTimer = null;
	}

	private hideTask(taskId: string): void {
		const task = this.tasks.get(taskId);
		if (!task) {
			return;
		}
		this.clearTaskTimer(task);
		task.notice.hide();
		this.tasks.delete(taskId);
	}

	private getLatestLine(task: TaskToastEntry): string {
		const latest = [...task.lines].reverse().find(line => line.trim());
		return latest?.trim() ?? "";
	}

	private formatMessage(title: string, status: TaskLogStatus, detail: string): DocumentFragment {
		const fragment = createFragment();
		const titleEl = createDiv();
		titleEl.className = "selection-translator-task-toast-title";
		titleEl.textContent = `${this.getStatusLabel(status)} ${title}`;
		titleEl.toggleClass("is-failed", status === "failed");
		titleEl.toggleClass("is-success", status === "success");
		fragment.appendChild(titleEl);

		if (detail) {
			const detailEl = createDiv();
			detailEl.className = "selection-translator-task-toast-detail";
			detailEl.textContent = detail;
			fragment.appendChild(detailEl);
		}

		return fragment;
	}

	private getStatusLabel(status: TaskLogStatus): string {
		if (status === "success") {
			return t(this.plugin, "common.status.done");
		}
		if (status === "failed") {
			return t(this.plugin, "common.status.failed");
		}
		if (status === "cancelled") {
			return t(this.plugin, "common.status.cancelled");
		}
		return t(this.plugin, "common.status.running");
	}
}
