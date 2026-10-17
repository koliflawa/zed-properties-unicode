#!/usr/bin/env node
/**
 * properties-unicode LSP — read and edit \uXXXX escapes in .properties files as native text (no dependencies, Node 18+).
 *
 *   inlay hints   appends the decoded line, greyed out, to every line containing \uXXXX (the source is untouched)
 *   hover         shows the decoded line under the cursor
 *   code actions  "Decode \uXXXX escapes (for editing)" — replaces every \uXXXX in the file with native text
 *                 "Escape to \uXXXX" — replaces every non-ASCII character with \uXXXX
 *   formatting    same as "Escape to \uXXXX" — with format_on_save the file is always escaped before it is written
 *   diagnostics   a warning on the first line that still holds non-ASCII characters
 *
 * Properties.load(InputStream) reads ISO-8859-1, so files loaded that way must stay ASCII — native text is silently garbled.
 * Only U+00A0 and above are decoded: decoding ASCII escapes such as = ('=') would move key/value boundaries.
 * Escaping writes upper-case hex for non-ASCII characters only, so decode → escape reproduces the original bytes.
 * An escaped backslash (\\uXXXX) is literal text and is left alone.
 */

const docs = new Map();

// ── conversion ────────────────────────────────────────

const ESC = /\\u([0-9A-Fa-f]{4})/g;

/** A \u is an escape only when preceded by an even number of backslashes (\\u is literal text). */
function isRealEscape(text, idx) {
  let n = 0;
  for (let i = idx - 1; i >= 0 && text[i] === '\\'; i--) n++;
  return n % 2 === 0;
}

function isHigh(c) { return c >= 0xd800 && c <= 0xdbff; }
function isLow(c) { return c >= 0xdc00 && c <= 0xdfff; }

export function decode(text) {
  let out = '';
  let last = 0;
  ESC.lastIndex = 0;
  let m;
  while ((m = ESC.exec(text))) {
    const code = parseInt(m[1], 16);
    if (code < 0xa0 || !isRealEscape(text, m.index) || isLow(code)) continue;
    let len = 6;
    let chars = String.fromCharCode(code);
    if (isHigh(code)) {
      // decode a surrogate pair only when both halves are adjacent — a lone surrogate cannot be saved as UTF-8
      const next = /^\\u([0-9A-Fa-f]{4})/.exec(text.slice(m.index + 6));
      if (!next || !isLow(parseInt(next[1], 16))) continue;
      chars += String.fromCharCode(parseInt(next[1], 16));
      len = 12;
    }
    out += text.slice(last, m.index) + chars;
    last = m.index + len;
    ESC.lastIndex = last;
  }
  return out + text.slice(last);
}

export function encode(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out += c < 0x80 ? text[i] : '\\u' + c.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

const hasNonAscii = (text) => /[^\x00-\x7f]/.test(text);
const hasDecodable = (text) => decode(text) !== text;

// ── LSP responses ─────────────────────────────────────

function lines(text) { return text.split(/\r?\n/); }

function wholeRange(text) {
  const ls = lines(text);
  return { start: { line: 0, character: 0 }, end: { line: ls.length - 1, character: ls[ls.length - 1].length } };
}

function inlayHints(text, range) {
  const ls = lines(text);
  const from = range ? range.start.line : 0;
  const to = range ? Math.min(range.end.line, ls.length - 1) : ls.length - 1;
  const hints = [];
  for (let i = from; i <= to; i++) {
    const decoded = decode(ls[i]);
    if (decoded === ls[i]) continue;
    hints.push({ position: { line: i, character: ls[i].length }, label: '  » ' + decoded.trim(), paddingLeft: true });
  }
  return hints;
}

function hover(text, pos) {
  const line = lines(text)[pos.line] ?? '';
  const decoded = decode(line);
  if (decoded === line) return null;
  return { contents: { kind: 'plaintext', value: decoded } };
}

function codeActions(uri, text) {
  const actions = [];
  if (hasDecodable(text)) {
    actions.push({
      title: 'Decode \\uXXXX escapes (for editing) — escaped again on save',
      kind: 'refactor.rewrite',
      edit: { changes: { [uri]: [{ range: wholeRange(text), newText: decode(text) }] } },
    });
  }
  if (hasNonAscii(text)) {
    actions.push({
      title: 'Escape to \\uXXXX',
      kind: 'source.fixAll',
      isPreferred: true,
      edit: { changes: { [uri]: [{ range: wholeRange(text), newText: encode(text) }] } },
    });
  }
  return actions;
}

function formatting(text) {
  return hasNonAscii(text) ? [{ range: wholeRange(text), newText: encode(text) }] : [];
}

function diagnostics(text) {
  if (!hasNonAscii(text)) return [];
  const ls = lines(text);
  const row = ls.findIndex((l) => hasNonAscii(l));
  return [{
    range: { start: { line: row, character: 0 }, end: { line: row, character: ls[row].length } },
    severity: 2,
    source: 'properties-unicode',
    message: 'Non-ASCII characters present — they are escaped to \\uXXXX on save (format_on_save). Saved as-is, Properties.load(InputStream) garbles them.',
  }];
}

// ── JSON-RPC (stdio) ──────────────────────────────────

function send(msg) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...msg }), 'utf8');
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function publish(uri) {
  send({ method: 'textDocument/publishDiagnostics', params: { uri, diagnostics: diagnostics(docs.get(uri) ?? '') } });
}

function handle(msg) {
  const { id, method, params } = msg;
  const reply = (result) => id !== undefined && send({ id, result });
  switch (method) {
    case 'initialize':
      return reply({
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          inlayHintProvider: true,
          codeActionProvider: { codeActionKinds: ['refactor.rewrite', 'source.fixAll'] },
          documentFormattingProvider: true,
        },
        serverInfo: { name: 'properties-unicode', version: '0.1.0' },
      });
    case 'textDocument/didOpen':
      docs.set(params.textDocument.uri, params.textDocument.text);
      return publish(params.textDocument.uri);
    case 'textDocument/didChange': {
      const changes = params.contentChanges;
      docs.set(params.textDocument.uri, changes[changes.length - 1].text);
      return publish(params.textDocument.uri);
    }
    case 'textDocument/didClose':
      docs.delete(params.textDocument.uri);
      return send({ method: 'textDocument/publishDiagnostics', params: { uri: params.textDocument.uri, diagnostics: [] } });
    case 'textDocument/inlayHint':
      return reply(inlayHints(docs.get(params.textDocument.uri) ?? '', params.range));
    case 'textDocument/hover':
      return reply(hover(docs.get(params.textDocument.uri) ?? '', params.position));
    case 'textDocument/codeAction':
      return reply(codeActions(params.textDocument.uri, docs.get(params.textDocument.uri) ?? ''));
    case 'textDocument/formatting':
      return reply(formatting(docs.get(params.textDocument.uri) ?? ''));
    case 'shutdown':
      return reply(null);
    case 'exit':
      return process.exit(0);
    default:
      if (id !== undefined) send({ id, error: { code: -32601, message: `method not supported: ${method}` } });
  }
}

function listen() {
  let buf = Buffer.alloc(0);
  process.stdin.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const sep = buf.indexOf('\r\n\r\n');
      if (sep < 0) return;
      const m = /Content-Length:\s*(\d+)/i.exec(buf.subarray(0, sep).toString('ascii'));
      if (!m) { buf = buf.subarray(sep + 4); continue; }
      const len = Number(m[1]);
      if (buf.length < sep + 4 + len) return;
      const body = buf.subarray(sep + 4, sep + 4 + len).toString('utf8');
      buf = buf.subarray(sep + 4 + len);
      try {
        handle(JSON.parse(body));
      } catch (e) {
        process.stderr.write(`[properties-unicode] ${e.stack || e}\n`);
      }
    }
  });
}

// imported as a module (e.g. by a check script): do not start the server
if (process.argv.includes('--stdio')) listen();
