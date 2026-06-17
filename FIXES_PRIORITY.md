# 代码修复优先级列表

## P1 - 高优先级（立即修复）

### 1. 修复内存泄漏
**文件**: `src/ui/translation-panel.ts`, `src/ui/quick-translation-panel.ts`

**问题**: 事件监听器未正确清理

**修复方案**:
```typescript
// 替换所有 addEventListener 为：
this.plugin.registerDomEvent(element, "event", handler);
```

**影响**: 长时间使用可能导致内存占用增加

---

### 2. 添加 API Key 安全警告
**文件**: `src/settings/api-profiles.ts`

**问题**: 用户可能不知道 API keys 明文存储

**修复方案**:
在每个 API Key 输入框下方添加警告文本：
```typescript
.setDesc("⚠️ API keys are stored unencrypted in Obsidian's data folder.")
```

---

## P2 - 中优先级（2周内修复）

### 3. 提取重复的 clipboard 代码
**文件**: 创建 `src/utils/clipboard.ts`

**代码**:
```typescript
export async function copyToClipboardWithNotice(
    plugin: TranslationPlugin,
    text: string,
    successKey: string,
    failKey: string
): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
        new Notice(t(plugin, successKey));
    } catch (error) {
        console.error("Failed to copy", error);
        new Notice(t(plugin, failKey));
    }
}
```

然后在以下文件中使用：
- `src/ui/translation-panel.ts:247`
- `src/ui/quick-translation-panel.ts:225`
- `src/immersive/manager.ts:215`

---

### 4. 重构过长方法
**文件**: `src/immersive/manager.ts`

**方法**: `processMarkdown` (103-130 行)

**拆分建议**:
```typescript
private async processMarkdown(...): Promise<void> {
    const blocks = this.filterTranslatableBlocks(allBlocks);
    const results = await this.translateBlocks(blocks);
    this.renderResults(results, containerEl);
}

private filterTranslatableBlocks(blocks: Block[]): Block[] { ... }
private async translateBlocks(blocks: Block[]): Promise<Result[]> { ... }
private renderResults(results: Result[], container: HTMLElement): void { ... }
```

---

### 5. 实现统一的 Logger 服务
**文件**: 创建 `src/utils/logger.ts`

**接口**:
```typescript
export class Logger {
    error(message: string, error: unknown, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
}
```

---

## P3 - 低优先级（持续改进）

### 6. 添加单元测试
**优先测试**:
- `src/translation/cache.ts` - 缓存逻辑
- `src/translation/text-filter.ts` - 文本过滤规则
- `src/translation/translate-service.ts` - 翻译服务核心逻辑

**测试框架**: Jest 或 Vitest

---

### 7. 统一命名规范
**规则**:
- 使用完整单词：`context` (不要 `ctx`)
- 元素变量统一后缀：`buttonEl`, `containerEl`
- 私有方法前缀：无需使用 `_`，TypeScript 有 `private` 关键字

---

### 8. 性能优化
**优化点**:
1. 大文档增量更新（`immersive/manager.ts`）
2. DOM 查询结果缓存（`block-collector.ts`）
3. 缓存保存批量提交策略（`cache.ts`）

---

## UI 改进优先级

### 高优先级

#### 1. 添加加载动画
**文件**: `src/ui/translation-panel.ts`, `src/ui/quick-translation-panel.ts`

**CSS**:
```css
.translation-panel-loading {
    position: relative;
}

.translation-panel-loading::after {
    content: '';
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid var(--interactive-accent);
    border-radius: 50%;
    border-top-color: transparent;
    animation: spin 0.6s linear infinite;
}

@keyframes spin {
    to { transform: rotate(360deg); }
}
```

---

#### 2. 实现键盘导航
**文件**: `src/ui/translation-panel.ts`

**功能**:
- ESC 关闭面板
- Tab 循环焦点
- 焦点陷阱

**代码**:
```typescript
this.plugin.registerDomEvent(this.rootEl, "keydown", (e: KeyboardEvent) => {
    if (e.key === "Escape") {
        this.close();
    }
});
```

---

#### 3. 添加 ARIA 支持
**文件**: `src/ui/translation-panel.ts`, `src/ui/quick-translation-panel.ts`

**修改**:
```typescript
this.rootEl.setAttribute("role", "dialog");
this.rootEl.setAttribute("aria-modal", "true");
this.rootEl.setAttribute("aria-labelledby", "panel-title");
```

---

### 中优先级

#### 4. 添加微交互动画
**CSS**:
```css
button {
    transition: all 0.2s ease;
}

button:hover {
    transform: scale(1.05);
}

button:active {
    transform: scale(0.95);
}
```

---

#### 5. 危险操作确认对话框
**文件**: `src/ui/dashboard.ts`

**位置**: 清空缓存按钮点击时

**代码**:
```typescript
button.addEventListener("click", async () => {
    const confirmed = await this.showConfirmDialog(
        "Clear all cache?",
        "This action cannot be undone."
    );
    if (confirmed) {
        this.plugin.translationCache.clear();
    }
});
```

---

#### 6. 移动端按钮增大
**CSS**:
```css
@media (pointer: coarse) {
    .translation-panel-toolbar button {
        min-width: 44px;
        min-height: 44px;
    }
}
```

---

## 完成清单

- [ ] P1-1: 修复事件监听器内存泄漏
- [ ] P1-2: 添加 API Key 安全警告
- [ ] P2-3: 提取重复的 clipboard 代码
- [ ] P2-4: 重构过长方法
- [ ] P2-5: 实现统一的 Logger
- [ ] UI-1: 添加加载动画
- [ ] UI-2: 实现键盘导航
- [ ] UI-3: 添加 ARIA 支持
- [ ] UI-4: 添加微交互动画
- [ ] UI-5: 危险操作确认对话框
- [ ] UI-6: 移动端按钮增大
- [ ] P3-6: 添加单元测试
- [ ] P3-7: 统一命名规范
- [ ] P3-8: 性能优化
