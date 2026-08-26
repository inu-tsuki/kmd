/**
 * Node-safe snapshot of the built-in command surface used by completion.
 *
 * Keep this module data-only: importing the runtime managers here would pull
 * Pixi/GSAP implementations into the language-service completion path. The
 * focused parity test compares every list with the live registries so command
 * additions cannot silently leave this snapshot stale. This is an internal
 * monorepo adapter, not a stable plugin contribution API.
 */
export const BUILTIN_EFFECT_COMMANDS = [
  'fadeIn', 'popIn', 'pulseIn', 'jumpIn', 'blurIn', 'punch', 'jump',
  'shake', 'wave', 'float', 'pulse', 'jitter', 'rotate', 'swing', 'gravity',
  'fadeShake', 'flash', 'rainbow', 'glitch',
  'rgbShift', 'warp', 'blur', 'pixelate', 'gray', 'threshold', 'duotone',
  'posterize', 'sharpen', 'emboss', 'edge', 'outline', 'bloom', 'halftone',
  'vignette', 'scanline', 'noise', 'dissolve', 'displace', 'underwater',
  'cyberGlitch', 'crtDisplay', 'neonGlow', 'digitalFlicker', 'hologram',
  'chromaticAberration', 'go', 'slow', 'fast', 'hold', 'border', 'box', 'dim',
  'shift',
] as const;

export const BUILTIN_STYLE_COMMANDS = [
  'red', 'blue', 'gray', 'green', 'yellow', 'purple', 'orange', 'cyan', 'pink',
  'bold', 'italic', 'thin', 'serif', 'special', 'size', 'font', 'sans', 'mono',
  'big', 'small', 'glow', 'stroke',
] as const;

export const BUILTIN_STAGE_COMMANDS = [
  'scene.clear', 'cam.move', 'cam.zoom', 'cam.rotate', 'cam.focus', 'cam.offset',
  'cam.reset', 'cam.shake', 'cam.drift', 'pause', 'bg',
] as const;

export const BUILTIN_LAYOUT_COMMANDS = [
  'mark', 'markStart', 'markEnd', 'goto', 'offset', 'left', 'up', 'right',
  'down', 'flow', 'markMiddle', 'markChar',
] as const;
