# KMD — Kinetic Markdown

Syntax highlighting and language support for Kinetic Markdown (`.kmd`) files in VSCode.

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
cd extensions/vscode-kmd
npm install -g @vscode/vsce   # if not already installed
vsce package
code --install-extension vscode-kmd-0.2.0.vsix
```

### Manual Installation
Copy the `vscode-kmd` folder to:
- **Windows**: `%USERPROFILE%\.vscode\extensions\`
- **macOS/Linux**: `~/.vscode/extensions/`

## Syntax Reference

For complete KMD syntax documentation, see the main [KMD Editor repository](https://github.com/kmd-editor/kmd-editor).

## License

MIT