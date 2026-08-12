# KMD — Kinetic Markdown

Syntax highlighting and language support for Kinetic Markdown (`.kmd`) files in VSCode.

The extension starts the shared KMD language server over Node IPC. Parser validation is published as
native VS Code diagnostics with command-level ranges.

## Features

### YAML Frontmatter
```yaml
---
title: My Animation
mode: stage
speed: 40
var:
  my_var: 100
---
```

### Comments
```kmd
// This is a comment
```

### Scene Clear
```kmd
---
```

### Block Options
```kmd
[align=center .glitch cam.zoom(0.7, 1s)!]
```

### Braced Groups
```kmd
{Hello} {World}
```

### Effect Chains
```kmd
@ f.red.wave(amp=5).hold(1s).blue
@ f.shake(strength=var.heavy_shake)
```

### Camera Commands
```kmd
@ cam.move(100, 0, 1s)!
@ cam.zoom(0.5, 2s)
@ cam.reset(1s)
```

### Layout Instructions
```kmd
@ .goto(0, 100)
@ .offset(center_point, 0)
@ markStart(p1)
```

### Timing Operators
| Operator | Meaning |
|----------|---------|
| `>` | Character-level advance |
| `>>` | Group-level advance |
| `>>>` | Block-level advance |
| `~` | Slow rhythm |
| `^` | Fast rhythm |
| `\|(1s)` | Pause pipe |

### Markdown Sugar
```kmd
**bold text**
*italic text*
# Heading
```

### Variables
```kmd
@ f.shake(strength=var.my_shake)
{The value is {var.my_value}}
```

### Control Flow
```kmd
@ if condition
@ elif other
@ else
@ end
@ loop 3
@ while condition
@ tag my_tag
@ jump my_tag
@ wait 1s
@ set var.x = 100
```

### Async Marker
The `!` suffix marks commands as asynchronous (non-blocking):
```kmd
@ cam.move(0, 400, 2s)!   // Camera moves while text continues
```

### Level Suffixes
```kmd
@ f.pause:char(1s)   // Character level
@ f.pause:group(1s)  // Group level
@ f.pause:block(1s)  // Block level
```

### Parameters with Units
```kmd
@ f.hold(1s)
@ f.hold(500ms)
@ .offset(1self)
@ f.hold(0.5em)
```

## Installation

### From Source
```bash
pnpm install                  # run from the repository root
pnpm language-server:build
pnpm vscode-kmd:build
pnpm --filter vscode-kmd package:check
npm install -g @vscode/vsce   # if not already installed
cd extensions/vscode-kmd
vsce package
code --install-extension vscode-kmd-0.2.0.vsix
```

`vscode-kmd:build` 会 bundle client，并把已 bundle 的语言服务器复制到扩展内 `dist/server.js`。
VSIX 因而不依赖 monorepo 的 `workspace:*` 包或 `node_modules`；`.vscodeignore` 只保留
client/server、语言资产、图标、README、LICENSE 与 manifest。

### Manual Installation
Copy the `vscode-kmd` folder to:
- **Windows**: `%USERPROFILE%\.vscode\extensions\`
- **macOS/Linux**: `~/.vscode/extensions/`

## Syntax Reference

For complete KMD syntax documentation, see the main KMD repository README plus `docs/knowledge/language/` and `docs/knowledge/runtime/`.

## License

Apache-2.0
