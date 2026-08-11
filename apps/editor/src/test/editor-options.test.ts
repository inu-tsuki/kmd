import { describe, expect, it, vi } from 'vitest';
import {
  KMD_EDITOR_FONT_FAMILY,
  KMD_EDITOR_FONT_SIZE,
  KMD_EDITOR_INPUT_OPTIONS,
  loadKmdEditorFont,
} from '../editor/editorOptions';

describe('Monaco 编辑器输入与字体初始化', () => {
  it('禁用 EditContext，并固定编辑器使用的字体度量参数', () => {
    expect(KMD_EDITOR_INPUT_OPTIONS).toMatchObject({
      editContext: false,
      fontSize: 14,
      fontFamily: "'Fira Code', 'Courier New', monospace",
    });
  });

  it('在编辑器创建前请求加载与配置一致的 Fira Code', async () => {
    const load = vi.fn().mockResolvedValue([]);

    await expect(loadKmdEditorFont({ load })).resolves.toBe(true);
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith(
      `400 ${KMD_EDITOR_FONT_SIZE}px "${KMD_EDITOR_FONT_FAMILY}"`,
    );
  });

  it('字体不可用时允许 Monaco 使用后备字体继续启动', async () => {
    const load = vi.fn().mockRejectedValue(new Error('font unavailable'));

    await expect(loadKmdEditorFont({ load })).resolves.toBe(false);
    await expect(loadKmdEditorFont(undefined)).resolves.toBe(false);
  });
});
