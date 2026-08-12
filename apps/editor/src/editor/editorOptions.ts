import type { editor } from 'monaco-editor';

export const KMD_EDITOR_FONT_FAMILY = 'Fira Code';
export const KMD_EDITOR_FONT_SIZE = 14;

export const KMD_EDITOR_INPUT_OPTIONS = {
  // Monaco 0.55 默认启用 Chromium EditContext。当前 Windows 输入路径会漏掉
  // 实体数字键的文本提交；先回退到成熟的 textarea 输入实现。
  editContext: false,
  fontSize: KMD_EDITOR_FONT_SIZE,
  fontFamily: `'${KMD_EDITOR_FONT_FAMILY}', 'Courier New', monospace`,
} satisfies Pick<
  editor.IStandaloneEditorConstructionOptions,
  'editContext' | 'fontSize' | 'fontFamily'
>;

interface EditorFontSet {
  load(font: string, text?: string): Promise<unknown>;
}

/**
 * Monaco 会缓存字符宽度；编辑器创建前先让主字体可用，避免先按回退字体
 * 测量、字体替换后光标位置随列数逐渐漂移。
 */
export async function loadKmdEditorFont(fontSet: EditorFontSet | undefined): Promise<boolean> {
  if (!fontSet) return false;

  try {
    await fontSet.load(`400 ${KMD_EDITOR_FONT_SIZE}px "${KMD_EDITOR_FONT_FAMILY}"`);
    return true;
  } catch {
    // 字体加载失败不应阻止编辑器启动，Monaco 会继续使用后备字体。
    return false;
  }
}
