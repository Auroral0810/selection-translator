import {TranslationError} from "./errors";

export interface RequestQueueOptions {
	rate: number;
	capacity: number;
	timeoutMs: number;
	maxRetries: number;
	baseRetryDelayMs: number;
}

export interface QueueTaskOptions {
	scheduleAt?: number;
	timeoutMs?: number;
	maxRetries?: number;
}

export interface RequestQueueStats {
	pending: number;
	active: number;
	duplicates: number;
}

export interface RequestQueueService {
	enqueue<T>(key: string, run: () => Promise<T>, options?: QueueTaskOptions): Promise<T>;
	updateOptions(options: Partial<RequestQueueOptions>): void;
	clear(reason?: unknown): void;
	getStats(): RequestQueueStats;
}

interface QueueTask<T> {
	key: string;
	run: () => Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
	scheduleAt: number;
	retryCount: number;
	timeoutMs: number;
	maxRetries: number;
	drained: boolean;
}

const MAX_RETRY_DELAY_MS = 30000;

export class DefaultRequestQueueService implements RequestQueueService {
	private readonly pending: Array<QueueTask<unknown>> = [];
	private readonly active = new Map<string, QueueTask<unknown>>();
	private readonly duplicates = new Map<string, Promise<unknown>>();
	private timer: number | null = null;
	private tokens: number;
	private lastRefillAt = Date.now();

	constructor(private options: RequestQueueOptions) {
		this.options = this.normalizeOptions(options);
		this.tokens = this.options.capacity;
	}

	enqueue<T>(key: string, run: () => Promise<T>, taskOptions: QueueTaskOptions = {}): Promise<T> {
		const duplicate = this.duplicates.get(key);
		if (duplicate) {
			return duplicate as Promise<T>;
		}

		const promise = new Promise<T>((resolve, reject) => {
			this.pending.push({
				key,
				run,
				resolve: resolve as (value: unknown) => void,
				reject,
				scheduleAt: taskOptions.scheduleAt ?? Date.now(),
				retryCount: 0,
				timeoutMs: taskOptions.timeoutMs ?? this.options.timeoutMs,
				maxRetries: taskOptions.maxRetries ?? this.options.maxRetries,
				drained: false,
			});
		});

		this.duplicates.set(key, promise);
		this.schedule();
		return promise.finally(() => {
			this.duplicates.delete(key);
		});
	}

	updateOptions(options: Partial<RequestQueueOptions>): void {
		this.options = this.normalizeOptions({...this.options, ...options});
		this.tokens = Math.min(this.tokens, this.options.capacity);
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.pending.length > 0) {
			this.schedule();
		}
	}

	clear(reason: unknown = new TranslationError("Translation queue was cleared.")): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}

		for (const task of this.pending) {
			this.rejectTask(task, reason);
		}
		this.pending.length = 0;

		for (const task of this.active.values()) {
			this.rejectTask(task, reason);
		}
		this.active.clear();
		this.duplicates.clear();
		this.tokens = this.options.capacity;
		this.lastRefillAt = Date.now();
	}

	getStats(): RequestQueueStats {
		return {
			pending: this.pending.length,
			active: this.active.size,
			duplicates: this.duplicates.size,
		};
	}

	private schedule(): void {
		if (this.timer !== null) {
			return;
		}

		const delay = this.getNextDelayMs();
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.drain();
		}, delay);
	}

	private drain(): void {
		this.refillTokens();
		this.sortPending();

		while (this.active.size < this.options.capacity && this.pending.length > 0) {
			const next = this.pending[0];
			const now = Date.now();
			if (!next || next.scheduleAt > now || this.tokens < 1) {
				break;
			}

			this.pending.shift();
			this.tokens -= 1;
			this.active.set(next.key, next);
			void this.execute(next);
		}

		if (this.pending.length > 0) {
			this.schedule();
		}
	}

	private async execute(task: QueueTask<unknown>): Promise<void> {
		try {
			const result = await this.withTimeout(task.run(), task.timeoutMs);
			if (!task.drained) {
				task.resolve(result);
			}
		} catch (error) {
			if (task.drained) {
				return;
			}

			if (isFatalQueueError(error)) {
				this.rejectTask(task, error);
				this.failCurrentBacklog(error);
				return;
			}

			if (task.retryCount < task.maxRetries) {
				task.retryCount++;
				task.scheduleAt = Date.now() + this.getRetryDelayMs(task.retryCount);
				this.pending.push(task);
				return;
			}

			task.reject(error);
		} finally {
			if (this.active.get(task.key) === task) {
				this.active.delete(task.key);
			}
			this.schedule();
		}
	}

	private failCurrentBacklog(error: unknown): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}

		for (const task of this.pending) {
			this.rejectTask(task, error);
		}
		this.pending.length = 0;

		for (const task of this.active.values()) {
			this.rejectTask(task, error);
		}
		this.active.clear();
		this.duplicates.clear();
	}

	private rejectTask(task: QueueTask<unknown>, error: unknown): void {
		if (task.drained) {
			return;
		}
		task.drained = true;
		task.reject(error);
	}

	private getNextDelayMs(): number {
		this.refillTokens();
		this.sortPending();
		const next = this.pending[0];
		if (!next) {
			return 0;
		}

		const now = Date.now();
		const scheduleDelay = Math.max(0, next.scheduleAt - now);
		const tokenDelay = this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.options.rate) * 1000);
		return Math.max(scheduleDelay, tokenDelay);
	}

	private refillTokens(): void {
		const now = Date.now();
		const elapsedMs = now - this.lastRefillAt;
		if (elapsedMs <= 0) {
			return;
		}

		this.tokens = Math.min(this.options.capacity, this.tokens + (elapsedMs / 1000) * this.options.rate);
		this.lastRefillAt = now;
	}

	private sortPending(): void {
		this.pending.sort((a, b) => a.scheduleAt - b.scheduleAt);
	}

	private getRetryDelayMs(retryCount: number): number {
		const base = this.options.baseRetryDelayMs * (2 ** Math.max(0, retryCount - 1));
		const jitter = Math.random() * base * 0.1;
		return Math.min(MAX_RETRY_DELAY_MS, base + jitter);
	}

	private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
		let timeoutId: number | undefined;
		const timeout = new Promise<never>((_resolve, reject) => {
			timeoutId = window.setTimeout(() => {
				reject(new TranslationError(`Translation task timed out after ${timeoutMs} ms.`));
			}, timeoutMs);
		});

		try {
			return await Promise.race([promise, timeout]);
		} finally {
			if (timeoutId !== undefined) {
				window.clearTimeout(timeoutId);
			}
		}
	}

	private normalizeOptions(options: RequestQueueOptions): RequestQueueOptions {
		return {
			rate: clampNumber(options.rate, 0.1, 100),
			capacity: Math.max(1, Math.floor(options.capacity)),
			timeoutMs: Math.max(1000, Math.floor(options.timeoutMs)),
			maxRetries: Math.max(0, Math.floor(options.maxRetries)),
			baseRetryDelayMs: Math.max(100, Math.floor(options.baseRetryDelayMs)),
		};
	}
}

function isFatalQueueError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	const status = extractHttpStatus(message);
	return status === 401 || status === 403 || status === 404 || status === 429;
}

function extractHttpStatus(message: string): number | null {
	const match = message.match(/\bHTTP\s+(\d{3})\b|\b(\d{3})\b/);
	if (!match) {
		return null;
	}
	const status = Number(match[1] ?? match[2]);
	return Number.isFinite(status) ? status : null;
}

function clampNumber(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, value));
}
