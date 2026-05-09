import { defineStore } from 'pinia';
import { ref, shallowRef, watch } from 'vue';
import type { ScriptPlayer } from '../core/player/ScriptPlayer';
import { stageManager } from '../core/stage/StageManager';
import * as fsService from '../services/fileSystem';
import type { FileNode } from '../services/fileSystem';

export const useEditorStore = defineStore('editor', () => {
  // --- 状态 (State) ---
  const kmdContent = ref("");
  const isPlaying = ref(false);
  const player = shallowRef<ScriptPlayer | null>(null);

  // 锁，防止双向同步死循环
  let isUpdatingFrontMatter = false;
  let isOpeningFile = false;

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
  };

  // 从编辑器文本解析并同步到 UI
  const syncConfigFromText = () => {
    const match = kmdContent.value.match(/^---\n([\s\S]*?)\n---/);
    if (match && match[1]) {
      const yaml = match[1];
      const lines = yaml.split('\n');
      lines.forEach(line => {
        const [key, ...valParts] = line.split(':');
        if (key && valParts.length > 0) {
          const k = key.trim();
          const v = valParts.join(':').trim();
          if (k === 'mode') canvasConfig.value.mode = v;
          else if (k === 'designWidth') canvasConfig.value.width = parseInt(v);
          else if (k === 'designHeight') canvasConfig.value.height = parseInt(v);
          else if (k === 'bgColor') canvasConfig.value.bgColor = v;
          else if (k === 'fontColor') canvasConfig.value.fontColor = v;
          else if (k === 'fontFamily') canvasConfig.value.fontFamily = v;
        }
      });
    }
  };

  // 从 UI 修改同步回编辑器文本
  const updateFrontMatter = () => {
    isUpdatingFrontMatter = true;
    const startMarker = "---";
    const endMarker = "---";
    const content = kmdContent.value;

    // 构造新的 YAML 字符串
    const newYaml = [
      `mode: ${canvasConfig.value.mode}`,
      `designWidth: ${canvasConfig.value.width}`,
      `designHeight: ${canvasConfig.value.height}`,
      `bgColor: ${canvasConfig.value.bgColor}`,
      `fontColor: ${canvasConfig.value.fontColor}`,
      `fontFamily: ${canvasConfig.value.fontFamily}`,
    ].join('\n');

    if (content.startsWith(startMarker)) {
      const secondMarkerIdx = content.indexOf(endMarker, 3);
      if (secondMarkerIdx !== -1) {
        // 替换已有头文件
        kmdContent.value = `${startMarker}\n${newYaml}\n${content.substring(secondMarkerIdx)}`;
      }
    } else {
      // 插入新头文件
      kmdContent.value = `${startMarker}\n${newYaml}\n${endMarker}\n\n${content}`;
    }

    // 使用 nextTick 思想，但在 store 中我们手动在同步逻辑结束后解锁
    // 由于 ref 修改是同步的，这里可以直接解锁，或者为了保险包裹在异步中
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
      isPlaying.value = true;
      await player.value.stop();
      await player.value.load(kmdContent.value);
      syncConfigFromPlayer();
      player.value.toggleAutoPlay(true);
    }
  };

  const stopScript = async () => {
    if (player.value) {
      isPlaying.value = false;
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
  watch(canvasConfig, () => {
    if (isUpdatingFrontMatter) return;

    if (player.value) {
      player.value.updateConfig({
        mode: canvasConfig.value.mode,
        designWidth: canvasConfig.value.width,
        designHeight: canvasConfig.value.height
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
    isPlaying,
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
