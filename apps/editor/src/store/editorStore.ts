import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';
import type { ScriptPlayer } from '../core/player/ScriptPlayer';
import type { ReaderRuntimePlaybackState } from '../core/runtime';
import { stageManager } from '../core/stage/StageManager';
import {
  extractFrontMatterBlock,
  serializeFrontMatter,
  setField,
  getField,
  serializeUIValue,
  UI_FRONTMATTER_KEYS,
} from '../core/parser/frontmatter';
import * as fsService from '../services/fileSystem';
import type { FileNode } from '../services/fileSystem';

export const useEditorStore = defineStore('editor', () => {
  // --- 状态 (State) ---
  const kmdContent = ref("");
  // SA-22：playbackState 是播放状态单一真相源（idle/loading/ready/playing/paused/ended/error），
  // 由 runtime adapter 写入（stop/load/play/pause/seek 全生命周期的 emit 链）。
  // isPlaying 保留为派生布尔供旧消费者读，但**不再由 store action 直接写**——
  // runScript/stopScript 原本乐观写 isPlaying=true/false 会与 adapter 的 emit 链竞争导致漂移。
  const playbackState = ref<ReaderRuntimePlaybackState>("idle");
  const isPlaying = ref(false);
  const isPreviewMaximized = ref(false);  // 预览最大化 toggle（CSS overlay，不卸载 canvas）
  const player = shallowRef<ScriptPlayer | null>(null);

  // 锁，防止双向同步死循环
  let isUpdatingFrontMatter = false;
  let isOpeningFile = false;
  // 文本→UI 同步期间的独立 guard：syncConfigFromText 修改 canvasConfig 是 host 读取
  // （W4：不得触发 frontmatter 写回），与显式 UI 操作区分开。
  let isSyncingFromText = false;

  // designWidth/designHeight 的字段级 coercion：autoConvert 对带引号的数字（"1920"）
  // 只去引号不转数字 → string 漏进 canvasConfig，但 ScriptPlayerConfig / setDesignResolution
  // 声明并按 number 使用。store 层对这两个 UI 数字字段统一 coerce，保留 core metadata
  // 共享解析语义（autoConvert 仍按通用规则解析，coercion 在 store 消费侧收口）。
  const coerceDim = (v: any): number =>
    typeof v === 'number' ? v : Number(v) || 0;

  // --- 文件系统状态 ---
  const projectHandle = shallowRef<FileSystemDirectoryHandle | null>(null)
  const fileTree = shallowRef<FileNode[]>([])
  const activeFilePath = ref<string | null>(null)
  const dirtyFiles = ref<Set<string>>(new Set())
  const openFileHandles = new Map<string, FileSystemFileHandle>()

  const canvasConfig = ref({
    mode: 'stage',
    width: 1920,
    height: 1080,
    bgColor: '#000000',
    fontColor: '#ffffff',
    fontFamily: 'Sasara Regular'
  });

  const currentTime = ref(0);
  const totalDuration = ref(0);
  const currentLine = ref(0);
  const timelineMarkers = ref<any[]>([]);
  const playbackSpeed = ref(1.0);

  // 监听内容变化，实现 Text -> UI 同步 + dirty 追踪
  watch(kmdContent, () => {
    if (!isUpdatingFrontMatter) {
      syncConfigFromText();
    }
    if (activeFilePath.value && !isOpeningFile) {
      const next = new Set(dirtyFiles.value)
      next.add(activeFilePath.value)
      dirtyFiles.value = next
    }
  });

  // --- 动作 (Actions) ---
  const setPlayer = (p: ScriptPlayer) => {
    player.value = p;
    p.updateConfig({
      mode: canvasConfig.value.mode,
      designWidth: coerceDim(canvasConfig.value.width),
      designHeight: coerceDim(canvasConfig.value.height),
      typography: {
        fill: canvasConfig.value.fontColor,
        fontFamily: canvasConfig.value.fontFamily,
      },
    });
  };

  // 从编辑器文本解析并同步到 UI —— 复用 core parser 行级解析(§3),不再用 store 内第二套正则。
  // 取经 autoConvert 的解析值,与 core parseMetadata 行为一致。
  const syncConfigFromText = () => {
    const block = extractFrontMatterBlock(kmdContent.value);
    if (!block) return; // 无 frontmatter:不动 canvasConfig(保留 UI 既有值)
    const lines = block.lines;

    // 文本→UI 同步是 host 读取，不是显式 UI 操作（W4：不得触发 frontmatter 写回）。
    // 与 isUpdatingFrontMatter 同模式：设 guard + 延后解锁到下一微任务，
    // 阻断本次 sync 修改 canvasConfig 触发 canvasConfig watcher → updateFrontMatter 的回写链。
    isSyncingFromText = true;

    const mode = getField(lines, 'mode');
    if (mode !== undefined) canvasConfig.value.mode = mode;
    const designWidth = getField(lines, 'designWidth');
    if (designWidth !== undefined) canvasConfig.value.width = coerceDim(designWidth);
    const designHeight = getField(lines, 'designHeight');
    if (designHeight !== undefined) canvasConfig.value.height = coerceDim(designHeight);
    const bgColor = getField(lines, 'bgColor');
    if (bgColor !== undefined) canvasConfig.value.bgColor = bgColor;
    const fontColor = getField(lines, 'fontColor');
    if (fontColor !== undefined) canvasConfig.value.fontColor = fontColor;
    const fontFamily = getField(lines, 'fontFamily');
    if (fontFamily !== undefined) canvasConfig.value.fontFamily = fontFamily;

    // 解锁延后到下一微任务，与 isUpdatingFrontMatter 同模式。
    setTimeout(() => {
      isSyncingFromText = false;
    }, 0);
  };

  // 从 UI 修改同步回编辑器文本 —— 合并式写回(规范 §5 W1–W4):
  // 解析现有 frontmatter → 只合并 UI 声明负责的 6 个键 → 序列化;未动行原样回写。
  // 整块替换是旧 bug,会丢失 title/speed/var:/未知字段/注释。
  const updateFrontMatter = () => {
    isUpdatingFrontMatter = true;
    const content = kmdContent.value;
    const block = extractFrontMatterBlock(content);

    // UI 声明负责的 6 个键 → canvasConfig 字段
    const uiValues: Record<string, any> = {
      mode: canvasConfig.value.mode,
      designWidth: coerceDim(canvasConfig.value.width),
      designHeight: coerceDim(canvasConfig.value.height),
      bgColor: canvasConfig.value.bgColor,
      fontColor: canvasConfig.value.fontColor,
      fontFamily: canvasConfig.value.fontFamily,
    };

    if (block) {
      // 合并:逐个 setField(W2:只写声明的字段)。仅当值变化才改行,进一步保 W3。
      let lines = block.lines;
      for (const key of UI_FRONTMATTER_KEYS) {
        const current = getField(lines, key);
        if (current !== uiValues[key]) {
          lines = setField(lines, key, uiValues[key]);
        }
      }
      const fmText = serializeFrontMatter(lines);
      // 重构:---\n<fm>\n--- + (body 非空则 \n+body)。body 为空字符串时无尾随换行。
      kmdContent.value = block.body.length > 0
        ? `---\n${fmText}\n---\n${block.body}`
        : `---\n${fmText}\n---`;
    } else {
      // 无 frontmatter:插入新块(§5 回归项 b)。沿用现状 6 字段 + 空行分隔正文。
      const fmText = UI_FRONTMATTER_KEYS
        .map(key => `${key}: ${serializeUIValue(key, uiValues[key])}`)
        .join('\n');
      kmdContent.value = `---\n${fmText}\n---\n\n${content}`;
    }

    // 解锁延后到下一微任务,避免本次同步写触发的 kmdContent watcher 再跑 syncConfigFromText 回环。
    setTimeout(() => {
      isUpdatingFrontMatter = false;
    }, 0);
  };

  const syncConfigFromPlayer = () => {
    if (player.value) {
      const meta = player.value.getMetadata;
      canvasConfig.value.mode = player.value.mode;
      canvasConfig.value.width = meta.designWidth || 1920;
      canvasConfig.value.height = meta.designHeight || 1080;
    }
  };

  const runScript = async () => {
    if (player.value) {
      // SA-22：不乐观写 isPlaying——player.stop()+load() 会发 loading→ready→playing 事件链，
      // adapter 据此设 playbackState/isPlaying。原 isPlaying.value=true 会在 stop() 发的
      // "idle"/"loading" 事件之前抢先写，造成与 adapter 短暂不一致。末尾 toggleAutoPlay(true)
      // 必发 "playing" 事件，adapter 最终把状态设对。
      await player.value.stop();
      await player.value.load(kmdContent.value);
      syncConfigFromPlayer();
      player.value.toggleAutoPlay(true);
    }
  };

  const stopScript = async () => {
    if (player.value) {
      // SA-22：不写 isPlaying.value=false——player.stop() 发 "idle" 事件，adapter 设状态。
      await player.value.stop();
    }
  };

  const nextStep = () => {
    player.value?.next(true);
  };

  const seekRelative = (deltaSeconds: number) => {
    if (player.value) {
      const current = currentTime.value / 1000;
      player.value.seekToTime(current + deltaSeconds);
    }
  };

  const setPlaybackSpeed = (speed: number) => {
    playbackSpeed.value = speed;
    player.value?.setTimeScale(speed);
  };

  // --- 文件系统操作 ---

  const openFolder = async () => {
    try {
      const handle = await fsService.openFolder()
      projectHandle.value = handle
      fileTree.value = await fsService.readDirectory(handle)
    } catch (err) {
      if ((err as Error).name !== 'AbortError') console.error('[FS] openFolder error:', err)
    }
  }

  const restoreProject = async () => {
    try {
      const handle = await fsService.restoreHandle()
      if (!handle) return
      projectHandle.value = handle
      fileTree.value = await fsService.readDirectory(handle)
    } catch {
      // 静默失败，用户手动打开即可
    }
  }

  const openFile = async (node: FileNode) => {
    if (node.kind !== 'file') return
    isOpeningFile = true
    try {
      const handle = node.handle as FileSystemFileHandle
      const content = await fsService.readFile(handle)
      openFileHandles.set(node.path, handle)
      activeFilePath.value = node.path
      kmdContent.value = content
    } finally {
      isOpeningFile = false
    }
  }

  const saveCurrentFile = async () => {
    if (!activeFilePath.value) return
    const handle = openFileHandles.get(activeFilePath.value)
    if (!handle) return
    try {
      await fsService.writeFile(handle, kmdContent.value)
      const next = new Set(dirtyFiles.value)
      next.delete(activeFilePath.value)
      dirtyFiles.value = next
    } catch (err) {
      console.error('[FS] save failed:', err)
    }
  }

  const refreshFileTree = async () => {
    if (!projectHandle.value) return
    fileTree.value = await fsService.readDirectory(projectHandle.value)
  }

  const setPreset = (preset: string) => {
    if (preset === '16:9') {
      canvasConfig.value.width = 1920;
      canvasConfig.value.height = 1080;
    } else if (preset === '9:16') {
      canvasConfig.value.width = 1080;
      canvasConfig.value.height = 1920;
    } else if (preset === '1:1') {
      canvasConfig.value.width = 1080;
      canvasConfig.value.height = 1080;
    }
  };

  // --- 布局引擎 (Layout Engine) ---

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const defaultLayout = {
    type: 'split',
    direction: 'horizontal',
    id: generateId(),
    children: [
      {
        type: 'split',
        direction: 'vertical',
        id: generateId(),
        size: 75,
        children: [
          { id: generateId(), type: 'window', size: 70, views: ['preview'] },
          { id: generateId(), type: 'window', size: 30, views: ['monitor'] }
        ]
      },
      {
        type: 'split',
        direction: 'vertical',
        id: generateId(),
        size: 25,
        children: [
          { id: generateId(), type: 'window', size: 60, views: ['explorer', 'editor'] },
          { id: generateId(), type: 'window', size: 40, views: ['inspector'] }
        ]
      }
    ]
  };

  const savedLayout = localStorage.getItem('kmd-layout');
  const layoutTree = ref<any>(savedLayout ? JSON.parse(savedLayout) : defaultLayout);

  // 审计日志
  const layoutAuditLog = ref<any[]>([]);

  // 核心修复：全量深度监听配置变化并同步到编辑器和引擎
  // 双锁：isUpdatingFrontMatter 防写回→sync 回环；isSyncingFromText 防文本→UI 同步→写回
  // （W4：文本→UI 同步是 host 读取，不是显式 UI 操作，不得触发 frontmatter 写回）。
  watch(canvasConfig, () => {
    if (isUpdatingFrontMatter || isSyncingFromText) return;

    if (player.value) {
      player.value.updateConfig({
        mode: canvasConfig.value.mode,
        designWidth: coerceDim(canvasConfig.value.width),
        designHeight: coerceDim(canvasConfig.value.height),
        typography: {
          fill: canvasConfig.value.fontColor,
          fontFamily: canvasConfig.value.fontFamily,
        },
      });
    }
    stageManager.setBackgroundColor(canvasConfig.value.bgColor);
    updateFrontMatter();
  }, { deep: true });

  const addAuditLog = (action: string, before: any, after: any, extra?: any) => {
    layoutAuditLog.value.push({
      time: new Date().toLocaleTimeString(),
      action,
      before: JSON.parse(JSON.stringify(before)),
      after: JSON.parse(JSON.stringify(after)),
      extra
    });
    if (layoutAuditLog.value.length > 50) layoutAuditLog.value.shift();
  };

  const logRealtimeSizes = (nodeId: string, sizes: number[]) => {
    layoutAuditLog.value.push({
      time: new Date().toLocaleTimeString(),
      action: 'REALTIME_RESIZE',
      nodeId,
      actualSizes: [...sizes]
    });
    if (layoutAuditLog.value.length > 100) layoutAuditLog.value.shift();
  };

  // 监听并保存布局
  watch(layoutTree, (newTree) => {
    localStorage.setItem('kmd-layout', JSON.stringify(newTree));
    // 强制触发多次全局 resize，确保在 transition 动画的不同阶段都能校准
    [50, 200, 500].forEach(delay => {
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, delay);
    });
  }, { deep: true });

  // 内部辅助：清理冗余节点并打平同向嵌套
  const performCleanup = (node: any): any => {
    if (node.type === 'split') {
      // 1. 递归处理所有子节点
      let processedChildren = node.children
        .map((child: any) => performCleanup(child))
        .filter((child: any) => child !== null);

      // 2. 核心重构：同向打平逻辑 (Ensuring shallowest tree)
      const flattenedChildren: any[] = [];
      processedChildren.forEach((child: any) => {
        if (child.type === 'split' && child.direction === node.direction) {
          const subTotal = child.children.reduce((a: number, c: any) => a + (c.size || 0), 0) || 100;
          child.children.forEach((subChild: any) => {
            subChild.size = (subChild.size / subTotal) * (child.size || 100);
            flattenedChildren.push(subChild);
          });
        } else {
          flattenedChildren.push(child);
        }
      });
      node.children = flattenedChildren;

      // 3. 如果分裂节点没有孩子，销毁该节点
      if (node.children.length === 0) return null;

      // 4. 如果分裂节点只有一个孩子，提升该孩子
      if (node.children.length === 1) {
        const singleChild = node.children[0];
        return { ...singleChild, size: node.size || 100 };
      }

      // 5. 规范化子节点 Size (确保和为 100)
      const totalSize = node.children.reduce((acc: number, c: any) => acc + (c.size || 0), 0);
      if (Math.abs(totalSize - 100) > 0.1 && totalSize > 0) {
        node.children.forEach((c: any) => {
          c.size = (c.size / totalSize) * 100;
        });
      }
    } else if (node.type === 'window') {
      if (!node.views || node.views.length === 0) return null;
    }
    return node;
  };

  // 内部辅助：从节点中移除 View
  const performRemoveView = (root: any, viewId: string) => {
    const traverse = (node: any): boolean => {
      if (node.type === 'window') {
        node.views = node.views.filter((v: string) => v !== viewId);
        return node.views.length === 0;
      }
      if (node.type === 'split') {
        node.children = node.children.filter((child: any) => !traverse(child));
        return node.children.length === 0;
      }
      return false;
    };
    traverse(root);
  };

  // 核心：原子化移动 View
  const moveView = (viewId: string, targetWindowId: string, position: 'top' | 'right' | 'bottom' | 'left' | 'center', sourceWindowId?: string) => {
    const oldTree = JSON.parse(JSON.stringify(layoutTree.value));
    const newTree = JSON.parse(JSON.stringify(layoutTree.value));

    // 1. 特殊情况：同窗口放下
    if (sourceWindowId === targetWindowId) {
      let nodeRef: any = null;
      let parentRef: any = null;
      const find = (n: any, p: any = null) => {
        if (n.id === targetWindowId) {
          nodeRef = n;
          parentRef = p;
        } else if (n.children) {
          n.children.forEach((c: any) => find(c, n));
        }
      };
      find(newTree);

      if (nodeRef && nodeRef.type === 'window') {
        if (position === 'center') {
          // 中心放下：仅调整顺序
          nodeRef.views = nodeRef.views.filter((v: string) => v !== viewId);
          nodeRef.views.push(viewId);
          layoutTree.value = newTree;
          addAuditLog(`MOVE_CENTER_SELF: ${viewId}`, oldTree, newTree);
          return;
        } else if (nodeRef.views.length === 1) {
          // 单标签页边缘放下逻辑
          const isVerticalDrop = position === 'top' || position === 'bottom';
          const isHorizontalDrop = position === 'left' || position === 'right';

          if (parentRef && parentRef.type === 'split') {
            const isMatch = (parentRef.direction === 'vertical' && isVerticalDrop) ||
              (parentRef.direction === 'horizontal' && isHorizontalDrop);

            if (isMatch && parentRef.children.length > 1) {
              const oldSize = nodeRef.size || 100;
              const newSize = oldSize / 2;
              const diff = oldSize - newSize;

              nodeRef.size = newSize;
              // 将多余空间分配给其他兄弟
              const siblings = parentRef.children.filter((c: any) => c.id !== nodeRef.id);
              siblings.forEach((s: any) => {
                s.size = (s.size || 0) + (diff / siblings.length);
              });

              layoutTree.value = newTree;
              addAuditLog(`RESIZE_SELF: ${viewId}`, oldTree, newTree);
              return;
            }
          }
          return; // 不匹配或无相邻，不做操作
        }
      }
    }

    // 2. 执行移除
    performRemoveView(newTree, viewId);

    // 3. 执行插入 (简单二叉分裂，依靠 performCleanup 自动打平)
    const insert = (node: any): any => {
      if (node.id === targetWindowId && node.type === 'window') {
        if (position === 'center') {
          if (!node.views.includes(viewId)) node.views.push(viewId);
          return node;
        } else {
          // 分裂逻辑
          const isVertical = position === 'top' || position === 'bottom';
          const direction = isVertical ? 'vertical' : 'horizontal';
          const isAfter = position === 'right' || position === 'bottom';

          const newNode = { id: generateId(), type: 'window', size: 50, views: [viewId] };
          // 关键：克隆旧节点并赋予新 ID，让原本的 node.id 留给 Split 容器或按需分配
          const oldNode = { ...node, size: 50 };

          return {
            type: 'split',
            direction,
            id: generateId(), // Split 容器获得新 ID
            size: node.size || 100,
            children: isAfter ? [oldNode, newNode] : [newNode, oldNode]
          };
        }
      }
      if (node.type === 'split') {
        node.children = node.children.map((c: any) => insert(c));
      }
      return node;
    };

    const treeWithInsert = insert(newTree);

    // 4. 递归清理
    let finalizedTree = performCleanup(treeWithInsert);

    // 5. 核心修复：根节点保护 (Ensuring single root)
    if (!finalizedTree) {
      // 兜底逻辑：如果树完全变空，保留一个带有当前 viewId 的窗口
      finalizedTree = { id: generateId(), type: 'window', views: [viewId] };
    }

    layoutTree.value = finalizedTree;
    addAuditLog(`MOVE_${position.toUpperCase()}: ${viewId}`, oldTree, finalizedTree);
  };

  // 7. 持久化手动调整的大小 (仅影响相邻节点)
  const setNodeSizesFromSplitter = (nodeId: string, idx: number, ratioInParent: number) => {
    const traverse = (node: any): boolean => {
      if (node.id === nodeId && node.type === 'split') {
        const childA = node.children[idx];
        const childB = node.children[idx + 1];
        if (childA && childB) {
          const combinedSize = (childA.size || 0) + (childB.size || 0);
          let prevSiblingsSize = 0;
          for (let i = 0; i < idx; i++) prevSiblingsSize += (node.children[i].size || 0);

          const newSizeA = ratioInParent - prevSiblingsSize;
          const newSizeB = combinedSize - newSizeA;

          if (newSizeA > 5 && newSizeB > 5) {
            childA.size = newSizeA;
            childB.size = newSizeB;
          }
        }
        return true;
      }
      if (node.type === 'split') {
        for (const child of node.children) if (traverse(child)) return true;
      }
      return false;
    };
    traverse(layoutTree.value);
  };

  // 8. 布局预设与存档
  const resetLayout = (type: 'default' | 'focus-editor' | 'focus-preview') => {
    const oldTree = JSON.parse(JSON.stringify(layoutTree.value));
    let newTree: any;
    if (type === 'focus-editor') {
      newTree = { id: generateId(), type: 'window', views: ['editor'] };
    } else if (type === 'focus-preview') {
      newTree = { id: generateId(), type: 'window', views: ['preview'] };
    } else {
      newTree = JSON.parse(JSON.stringify(defaultLayout));
      const refreshIds = (n: any) => {
        n.id = generateId();
        if (n.children) n.children.forEach(refreshIds);
      };
      refreshIds(newTree);
    }
    layoutTree.value = newTree;
    addAuditLog(`RESET: ${type}`, oldTree, newTree);
  };

  const saveLayout = (slot: number) => {
    localStorage.setItem(`kmd-layout-slot-${slot}`, JSON.stringify(layoutTree.value));
  };

  const loadLayout = (slot: number) => {
    const oldTree = JSON.parse(JSON.stringify(layoutTree.value));
    const saved = localStorage.getItem(`kmd-layout-slot-${slot}`);
    if (saved) {
      const newTree = JSON.parse(saved);
      layoutTree.value = newTree;
      addAuditLog(`LOAD_SLOT: ${slot}`, oldTree, newTree);
    }
  };

  return {
    kmdContent,
    playbackState,
    isPlaying,
    isPreviewMaximized,
    togglePreviewMaximized: () => { isPreviewMaximized.value = !isPreviewMaximized.value; },
    player,
    canvasConfig,
    currentTime,
    totalDuration,
    currentLine,
    timelineMarkers,
    playbackSpeed,
    layoutTree,
    layoutAuditLog,
    // 文件系统
    projectHandle,
    fileTree,
    activeFilePath,
    dirtyFiles,
    setPlayer,
    runScript,
    stopScript,
    nextStep,
    seekRelative,
    setPlaybackSpeed,
    syncConfigFromPlayer,
    setPreset,
    moveView,
    setNodeSizesFromSplitter,
    logRealtimeSizes,
    resetLayout,
    saveLayout,
    loadLayout,
    openFolder,
    restoreProject,
    openFile,
    saveCurrentFile,
    refreshFileTree
  };
});
