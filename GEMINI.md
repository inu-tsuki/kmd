# KMD Editor Context

## Project Overview

**kmd-editor** is a web-based Kinetic Motion Display (KMD) engine and editor. It renders animated, styled text based on a custom markup syntax (KMD strings). The project utilizes **Pixi.js** for high-performance 2D rendering and **GSAP** for complex animations, all wrapped within a **Vue 3** application powered by **Vite**.

The core purpose is to parse formatted text strings (e.g., `"{Hello} @ wave"`) and render them as dynamic, animated graphical elements.

## Tech Stack

*   **Framework:** Vue 3 (Composition API, `<script setup>`)
*   **Build Tool:** Vite
*   **Language:** TypeScript
*   **Rendering:** Pixi.js (v8+)
*   **Animation:** GSAP (GreenSock Animation Platform)
*   **Package Manager:** pnpm (implied by `pnpm-lock.yaml`)

## Architecture & Core Concepts

The application logic is centralized in `src/core`.

### 1. The Rendering Pipeline
The flow from string to screen is roughly:
1.  **Input:** A "KMD String" (e.g., `"{Target} @ effect"`) is passed to the engine.
2.  **Parser (`src/core/parser`):** Breaks the string into tokens, separating content from style/effect metadata.
3.  **Construction (`src/core/KineticText.ts`):**
    *   Creates a `KineticText` container (extends Pixi `Container`).
    *   Iterates tokens to create `TokenWrapper` objects.
    *   Inside wrappers, creates `KineticChar` objects for individual characters.
4.  **Styling & Effects (`src/core/effects`):**
    *   `StyleManager`: Applies static styles (font, color) via Pixi `TextStyle`.
    *   `EffectManager`: Applies dynamic animations (shake, wave, glow) using GSAP or Pixi filters.
5.  **Layout (`src/core/layout`):** `LayoutEngine` manages the positioning of lines on the canvas (like a terminal or novel reader).

### 2. KMD Syntax (Inferred)
Based on `ReaderCanvas.vue`, the syntax supports:
*   **Grouping:** `{text}` groups characters for specific effects.
*   **Directives:** `@` separates content from effects/styles.
*   **Chaining:** Effects can be chained (e.g., `.red.shake.glow`).
*   **Parameters:** `f(blue, bold)` seems to be a function-style syntax.

**Example:**
```
{第一章}：觉醒 @ f.big.bold
我回答：{不愿意}。 @ f(blue, bold, shake, wave)
```

## Key Directories

*   **`src/core/`**: The core kinetic text engine.
    *   `effects/`: Managers for styles and GSAP animations.
    *   `layout/`: Manages line positioning.
    *   `parser/`: Parses KMD syntax.
    *   `KineticText.ts`: The main container for a block of text.
    *   `KineticChar.ts`: Represents a single character.
*   **`src/components/`**: Vue components.
    *   `ReaderCanvas.vue`: The main view component that initializes the engine and demonstrates usage.
*   **`src/App.vue`**: Root Vue component.

## Development

### Setup & Run
```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Build for production
pnpm build
```

### Conventions
*   **TypeScript:** Strict typing is encouraged.
*   **Vue:** Use `<script setup>` syntax.
*   **Pixi:** Extend Pixi classes (like `Container`) for custom display objects.
*   **Effects:** Separate static styles (Pixi properties) from dynamic effects (GSAP/Tickers).
