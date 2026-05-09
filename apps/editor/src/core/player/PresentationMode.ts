export interface PresentationMode {
  // 当剧本请求显示新的一行时调用
  // 返回 Promise 表示这一行的“展示过程”结束（比如打字机打完，或者滚动动画做完）
  present(content: string): Promise<void>;

  // 处理滚轮事件 (可选)
  onScroll?(deltaY: number): void;

  // 清理/重置
  reset(): void;
}
