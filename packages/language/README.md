# @kmd/language

Shared KMD language assets for workspace packages.

This package currently exposes the TextMate grammar and VS Code language
configuration through stable package subpaths:

- `@kmd/language/syntaxes/kmd.tmLanguage.json`
- `@kmd/language/language-configuration.json`

`packages/language` is the canonical source. The VS Code extension keeps static
packaged copies because an installed VSIX cannot resolve monorepo workspace
files. After changing an asset, run:

```bash
pnpm language:sync
pnpm language:check
```

`language:sync` is the only write step and copies bytes without parsing or
serializing JSON. It is deliberately explicit: build and package commands run
the read-only `language:check` first and fail on drift instead of silently
rewriting tracked extension files. Review copied asset diffs before committing.
