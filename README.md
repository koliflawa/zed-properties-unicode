# Properties Unicode Escapes — Zed extension

Read and edit `\uXXXX` escapes in Java `.properties` files as native text, then escape them back on save.

Files loaded with `java.util.Properties.load(InputStream)` are read as ISO-8859-1, so any non-Latin text
(Korean, Japanese, Chinese, Cyrillic, …) has to be stored as `\uXXXX`. Unescaped text is not an error — the
values are just silently garbled at runtime. IntelliJ handles this with "Transparent native-to-ascii conversion";
this extension brings the same workflow to Zed as a small language server.

| Feature | Behavior |
|---|---|
| Inlay hints | Appends the decoded line, greyed out, to every line that contains `\uXXXX` (the source is untouched) |
| Hover | Shows the decoded line under the cursor |
| Code action `Decode \uXXXX escapes (for editing)` | Replaces every escape in the file with native text, for editing |
| Formatting / code action `Escape to \uXXXX` | Escapes every non-ASCII character. With `format_on_save` this runs on every save |
| Diagnostics | Warns while non-ASCII characters are still in the buffer |

What you see in the editor (the part after `»` is the inlay hint):

```text
greeting=\uC548\uB155\uD558\uC138\uC694   » greeting=안녕하세요
title=\u65E5\u672C\u8A9E                      » title=日本語
```

Round-trip safe: only U+00A0 and above are decoded (decoding ASCII escapes such as `\u003D` (`=`) would move key/value
boundaries), surrogate pairs are decoded only when both halves are present, escaped backslashes (`\\uXXXX`) are left
alone, and escaping writes upper-case hex — so decode → escape reproduces the original bytes.

## Requirements

- The **Java** extension, which provides the `Properties` language (grammar) this extension attaches to.
- No other dependencies. On first use the extension downloads the server — a single dependency-free script,
  `properties-unicode-lsp.mjs` — from this repository's [GitHub releases](https://github.com/koliflawa/zed-properties-unicode/releases)
  and runs it with the Node.js bundled with Zed. Without network access it keeps using the last downloaded version.

## Settings

Add to your Zed `settings.json`:

```jsonc
"languages": {
  "Properties": {
    "format_on_save": "on",
    "formatter": { "language_server": { "name": "properties-unicode" } },
    "remove_trailing_whitespace_on_save": false,   // trailing spaces are part of a value
    "inlay_hints": { "enabled": true }
  }
}
```

Without `format_on_save` the file is saved with native text — run the `Escape to \uXXXX` code action (or
`editor: format`) before saving.

## Workflow

This is not fully transparent like IntelliJ: a Zed extension cannot intercept file reads and writes, so the buffer
always matches what is on disk. The workflow is:

1. **Open** — the buffer keeps the `\uXXXX` escapes. Inlay hints show the decoded text at the end of each line;
   hover shows it for the line under the cursor.
2. **Decode to edit** — open the code actions menu (`ctrl-.` / `cmd-.`, or `alt-enter` with the JetBrains base keymap) and run `Decode \uXXXX escapes (for editing)`.
   The buffer now shows native text, and a warning diagnostic marks it as not yet escaped.
   (You can also type native text directly without decoding first.)
3. **Save** — `format_on_save` escapes every non-ASCII character to `\uXXXX` right before the file is written.
   The buffer shows escapes again afterwards; decode again to keep editing.

Escaping happens only through formatting. If you save without formatting (`workspace: save without format`),
or the language server is not running, native text is written as-is — the warning diagnostic is the signal that
the buffer still needs escaping.

Decoding is deliberately not automatic on open: editing the buffer on open would mark every file as modified and
pollute undo history on every save.

## Development

Install Rust via [rustup](https://rustup.rs), then in Zed run `zed: install dev extension` and pick this folder.

To run a local copy of the server instead of the released one, point the language server at it:

```jsonc
"lsp": {
  "properties-unicode": {
    "binary": { "path": "node", "arguments": ["/path/to/server/properties-unicode-lsp.mjs", "--stdio"] }
  }
}
```

Releases are published by pushing a `vX.Y.Z` tag; the workflow checks that `extension.toml`, `Cargo.toml` and the
server report the same version and attaches the script to the release.

## License

MIT
