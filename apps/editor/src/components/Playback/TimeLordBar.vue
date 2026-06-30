<template>
  <div class="time-lord-bar">
    <!-- 播放/暂停按钮 -->
    <button
      class="play-btn"
      @click="togglePlay"
      :title="isPlaying ? '暂停 (Space)' : '播放 (Space)'"
    >
      {{ isPlaying ? "⏸" : "▶" }}
    </button>

    <!-- 时间轴（可拖拽）-->
    <div class="timeline-track" ref="trackRef" @mousedown="handleScrubStart">
      <!-- 时序块渲染 -->
      <div
        v-for="(m, idx) in store.timelineMarkers"
        :key="idx"
        class="time-block"
        :class="m.type"
        :style="getBlockStyle(m)"
        :title="`Line ${m.line}: ${m.content}`"
      ></div>

      <!-- 播放头 -->
      <div class="playhead" :style="{ left: playheadPos + '%' }">
        <div class="playhead-handle"></div>
      </div>
    </div>

    <!-- 时间信息 -->
    <div class="time-info">
      <span>{{ formatTime(store.currentTime) }}</span>
      <span class="total">/ {{ formatTime(store.totalDuration) }}</span>
    </div>

    <!-- 速度控制 -->
    <div class="speed-group">
      <button
        v-for="speed in [0.5, 1, 2]"
        :key="speed"
        class="speed-btn"
        :class="{ active: store.playbackSpeed === speed }"
        @click="store.setPlaybackSpeed(speed)"
      >
        {{ speed }}x
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { useEditorStore } from "../../store/editorStore";

const store = useEditorStore();
const trackRef = ref<HTMLElement | null>(null);
const isScrubbing = ref(false);
const wasPlaying = ref(false);

// SA-22：播放状态读 store.playbackState（单一真相源），不再直读 player.autoPlay
// （后者与 store.isPlaying 是两个不同步的真相源，Alt+Click 等路径会让它们漂移）。
const isPlaying = computed(() => store.playbackState === "playing");

const togglePlay = () => {
  store.player?.toggleAutoPlay();
};

const playheadPos = computed(() => {
  if (store.totalDuration === 0) return 0;
  return (store.currentTime / store.totalDuration) * 100;
});

const getBlockStyle = (m: any) => {
  if (store.totalDuration === 0) return {};
  return {
    left: (m.startTime / store.totalDuration) * 100 + "%",
    width: (m.duration / store.totalDuration) * 100 + "%",
  };
};

const formatTime = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const dec = Math.floor((ms % 1000) / 100);
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}.${dec}`;
};

// --- Scrubbing 交互 ---

const handleScrubStart = (e: MouseEvent) => {
  isScrubbing.value = true;
  // F7: 记录拖拽前播放状态，暂停 Timeline 避免 onUpdate 冲突。
  // SA-22：读 store.playbackState（单一真相源）而非 player.autoPlay。
  wasPlaying.value = store.playbackState === "playing";
  store.player?.pauseSegment();
  updateScrub(e);
  window.addEventListener("mousemove", handleScrubMove);
  window.addEventListener("mouseup", handleScrubEnd);
};

const handleScrubMove = (e: MouseEvent) => {
  if (isScrubbing.value) updateScrub(e);
};

const updateScrub = (e: MouseEvent) => {
  if (!trackRef.value) return;
  const rect = trackRef.value.getBoundingClientRect();
  let x = e.clientX - rect.left;
  let ratio = Math.max(0, Math.min(1, x / rect.width));
  const targetTime = ratio * store.totalDuration;

  store.currentTime = targetTime;
};

const handleScrubEnd = () => {
  if (!isScrubbing.value) return;
  isScrubbing.value = false;
  window.removeEventListener("mousemove", handleScrubMove);
  window.removeEventListener("mouseup", handleScrubEnd);

  // 精确时间跳转
  const targetTime = store.currentTime;
  const targetSeconds = targetTime / 1000;
  console.log(
    `[UI-Jump] Scrub ended at ${targetTime.toFixed(0)}ms → seekToTime(${targetSeconds.toFixed(2)}s)`,
  );
  store.player?.seekToTime(targetSeconds);
  // F7: 恢复拖拽前的播放状态。
  // R7-2/SA-22：wasPlaying 只反映"拖拽前在播"的意图，而非 seek 后的实际状态。
  // seek 落在末尾时 seekToTime 已 settle 为 ended（adapter 据此设 playbackState="ended"），
  // 此时不应 resume——playSegment 对 ended 是 restart 语义会从 0 重播。
  // 用"拖拽前在播 且 seek 后未 ended"判定：playbackState 是 settle 后的真实状态（单一真相源）。
  if (wasPlaying.value && store.playbackState !== "ended") store.player?.playSegment();
};
</script>

<style scoped>
.time-lord-bar {
  height: 40px;
  background: var(--bg-header);
  border-top: 1px solid var(--border-dark);
  display: flex;
  align-items: center;
  padding: 0 15px;
  gap: 15px;
  user-select: none;
}

.timeline-track {
  flex: 1;
  height: 12px;
  background: var(--border-dark);
  border-radius: 6px;
  position: relative;
  cursor: pointer;
  overflow: hidden; /* 暂时隐藏溢出，防止圆角失效 */
}

.time-block {
  position: absolute;
  top: 2px;
  bottom: 2px;
  background: var(--bg-active);
  border-radius: 1px;
  min-width: 1px;
  opacity: 0.6;
  transition: opacity 0.2s;
}
.time-block:hover {
  opacity: 1;
  background: var(--accent-secondary);
}

.time-block.scene {
  background: var(--accent-warn);
  opacity: 0.8;
}

.playhead {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--accent-primary);
  z-index: 10;
  pointer-events: none;
}

.playhead-handle {
  position: absolute;
  top: -4px;
  left: -4px;
  width: 10px;
  height: 10px;
  background: var(--accent-primary);
  border-radius: 50%;
  box-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
}

.time-info {
  font-family: "Fira Code", monospace;
  font-size: 11px;
  color: var(--accent-primary);
  min-width: 100px;
}

.time-info .total {
  color: var(--text-dim);
}

.play-btn {
  background: transparent;
  border: 1px solid var(--border-dark);
  color: var(--accent-primary);
  width: 28px;
  height: 22px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.play-btn:hover {
  background: var(--bg-active);
}

.speed-group {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}

.speed-btn {
  background: transparent;
  border: 1px solid var(--border-dark);
  color: var(--text-dim);
  padding: 1px 6px;
  font-size: 10px;
  border-radius: 2px;
  cursor: pointer;
}
.speed-btn:hover {
  border-color: var(--accent-primary);
  color: var(--accent-primary);
}
.speed-btn.active {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
  color: #fff;
}
</style>
