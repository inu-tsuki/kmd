# Kinetic Markdown (KMD) Editor

![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Vue 3](https://img.shields.io/badge/Vue%203-4FC08D?style=for-the-badge&logo=vue.js&logoColor=white)
![PixiJS](https://img.shields.io/badge/PixiJS-E91E63?style=for-the-badge&logo=pixijs&logoColor=white)
![GSAP](https://img.shields.io/badge/GSAP-88CE02?style=for-the-badge&logo=greensock&logoColor=white)

**Kinetic Markdown (KMD)** is a specialized markup language and rendering engine designed for creating animated, highly stylized text displays. It combines the simplicity of Markdown-like syntax with the power of modern GPU rendering and professional animation tools.

## ✨ Features

- 🚀 **High Performance:** GPU-accelerated rendering via Pixi.js v8.
- 🎭 **Rich Animations:** Seamless integration with GSAP for complex kinetic typography.
- 🎨 **Flexible Styling:** Effortless control over colors, fonts, and custom shaders (RGB Split, Warp, etc.).
- 📝 **Expressive Syntax:** A simple `@` based command system for local and global effects.
- 📐 **Advanced Layout:** Precise positioning with relative units (`self`, `char`, `line`) and reserved markers (`prev`, `line`, `next`).
- 🌊 **Flow Control:** Dynamic text flow management (In-Flow/Out-of-Flow) for complex HUD and overlay elements.
- 📦 **Paragraph Blocks:** Support for multi-line paragraphs (`\n\n`) with shared block-level properties.
- 🕹️ **Smart Playback:** Built-in support for auto-play, manual controls, and external KMD script loading.

## 🚀 Quick Start

### Syntax at a Glance

```text
[align=center .glitch] 
{Hello} {World} @ .ease(1s).goto(globalmark_up) f.red.wait(1s).shake f.blue.wave
```

- **`{...}`**: Define a token (group of characters).
- **`@`**: Command separator (supports multiple sub-line blocks).
- **`f.effect`**: Apply style/effect to a token.
- **`.effect`**: Apply global effect to the entire paragraph.
- **`[...]`**: Block options, global effects, and startup instructions.

### Advanced Usage

- **Precise Alignment:** `{Centered} @ f.left(0.5self)` (Align token by its own center).
- **Relative Positioning:** `{Note} @ f.goto(prev.end).right(10)` (Attach to previous sentence).
- **HUD Elements:** `{LIFE: 100} @ f.goto(10, 10).blue` (Floating text that doesn't occupy flow).
- **Level Selectors:** `.shake:char` (Every character jitters) vs `.shake:block` (Whole paragraph shakes).

### Example Gallery

- **Emphasis:** `{Important} @ f.red.bold.pulse`
- **Glitch Style:** `System Error @ .glitch.rgbShift(dist=10)`
- **Dynamic Wave:** `{Swimming...} @ f.blue.wave(amp=20, freq=0.5)`
- **Composite:** `[indent=2] {Warning:} Low battery @ f.yellow.blink`

## 🛠️ Installation & Development

This project uses `pnpm` as the package manager.

```bash
# Clone the repository
git clone https://github.com/your-repo/kmd-editor.git
cd kmd-editor

# Install dependencies
pnpm install

# Start the development server
pnpm dev

# Build for production
pnpm build
```

## 🏗️ Architecture

- **`src/core/parser`**: The KMD syntax parser.
- **`src/core/effects`**: Central managers for styles and GSAP-based animations.
- **`src/core/layout`**: Text layout engine for handling lines and paragraph blocks.
- **`src/core/filters`**: Custom Pixi.js filters for advanced visual effects.
- **`src/components`**: Vue components for the editor and preview canvas.

## 📄 License

[MIT](LICENSE)
