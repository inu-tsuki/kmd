# @kmd/language

Shared KMD language assets for workspace packages.

This package currently exposes the TextMate grammar and VS Code language
configuration through stable package subpaths:

- `@kmd/language/syntaxes/kmd.tmLanguage.json`
- `@kmd/language/language-configuration.json`

The VS Code extension still keeps local packaged copies so it can work without a
build step. Run `pnpm language:check` after changing these assets to catch drift
between the package and extension copies.
