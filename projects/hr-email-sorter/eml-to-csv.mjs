#!/usr/bin/env node
/**
 * يحوّل مجلدًا فيه رسائل محفوظة (.eml) إلى ملف CSV جاهز للفارز.
 *
 * من أين تأتي ملفات .eml؟
 *   Gmail        افتح الرسالة ← ⋮ ← Download message
 *   Outlook.com  افتح الرسالة ← ⋯ ← Download
 *   Thunderbird  حدّد الرسائل ← اسحبها إلى مجلد على سطح المكتب
 *
 * التشغيل:
 *   node eml-to-csv.mjs                 ← مجلد emails/ بجانب المشروع
 *   node eml-to-csv.mjs "C:/رسائلي"     ← مجلدك
 *   node eml-to-csv.mjs emails out.csv  ← باسم ملف تختاره
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const SRC = args[0] || join(HERE, 'emails');
const OUT = args[1] || join(HERE, 'my-emails.csv');

const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', red: '\x1b[31m', c: '\x1b[36m' };

// ───────── فكّ ترميزات البريد ─────────

function decodeQP(s, charset) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /[0-9A-Fa-f]{2}/.test(s.slice(i + 1, i + 3))) {
      bytes.push(parseInt(s.slice(i + 1, i + 3), 16)); i += 2;
    } else if (s[i] === '=' && s[i + 1] === '\n') { i += 1; }
    else if (s[i] === '=' && s[i + 1] === '\r' && s[i + 2] === '\n') { i += 2; }
    else bytes.push(s.charCodeAt(i));
  }
  return decodeBytes(Buffer.from(bytes), charset);
}

function decodeBytes(buf, charset) {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  try {
    if (/^(utf-?8|us-ascii|ascii)$/.test(cs)) return buf.toString('utf8');
    return new TextDecoder(cs).decode(buf);      // windows-1256، iso-8859-6 وغيرها
  } catch { return buf.toString('utf8'); }
}

/** يفكّ =?UTF-8?B?...?= التي تحمل العربية في العناوين. */
function decodeWords(s) {
  return String(s || '').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=(\s*(?==\?))?/g,
    (_, cs, enc, txt) => enc.toUpperCase() === 'B'
      ? decodeBytes(Buffer.from(txt, 'base64'), cs)
      : decodeQP(txt.replace(/_/g, ' '), cs));
}

// ───────── تحليل الرسالة ─────────

function splitHeaders(raw) {
  const end = raw.search(/\r?\n\r?\n/);
  const head = end === -1 ? raw : raw.slice(0, end);
  const body = end === -1 ? '' : raw.slice(end).replace(/^\r?\n\r?\n/, '');
  const headers = {};
  // ضمّ الأسطر المكسورة التي تبدأ بمسافة
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':');
    if (i > 0) {
      const k = line.slice(0, i).trim().toLowerCase();
      if (!(k in headers)) headers[k] = line.slice(i + 1).trim();
    }
  }
  return { headers, body };
}

const stripHtml = (h) => h
  .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

function decodeBody(headers, body) {
  const enc = String(headers['content-transfer-encoding'] || '').toLowerCase().trim();
  const ct = String(headers['content-type'] || 'text/plain');
  const cs = (ct.match(/charset\s*=\s*"?([^";\s]+)/i) || [])[1] || 'utf-8';
  let text;
  if (enc === 'base64') text = decodeBytes(Buffer.from(body.replace(/\s/g, ''), 'base64'), cs);
  else if (enc === 'quoted-printable') text = decodeQP(body, cs);
  else text = body;
  if (/text\/html/i.test(ct)) text = stripHtml(text);
  return text;
}

/** يختار الجزء النصي من الرسالة، ولو كانت متعددة الأجزاء. */
function extractText(headers, body, depth = 0) {
  const ct = String(headers['content-type'] || '');
  const boundary = (ct.match(/boundary\s*=\s*"?([^";\s]+)/i) || [])[1];
  if (!boundary || depth > 4) return decodeBody(headers, body);

  const parts = body.split(new RegExp('--' + boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .slice(1, -1).map((p) => splitHeaders(p.replace(/^\r?\n/, '')));

  const plain = parts.find((p) => /text\/plain/i.test(p.headers['content-type'] || 'text/plain'));
  if (plain) return extractText(plain.headers, plain.body, depth + 1);
  const html = parts.find((p) => /text\/html/i.test(p.headers['content-type'] || ''));
  if (html) return extractText(html.headers, html.body, depth + 1);
  const nested = parts.find((p) => /multipart/i.test(p.headers['content-type'] || ''));
  if (nested) return extractText(nested.headers, nested.body, depth + 1);
  return '';
}

function parseEml(raw) {
  const { headers, body } = splitHeaders(raw);
  const from = decodeWords(headers.from || '');
  const addr = (from.match(/<([^>]+)>/) || [])[1] || from.trim();
  let text = extractText(headers, body)
    .replace(/\r/g, '')
    .split('\n').filter((l) => !/^>/.test(l))          // اقتباس الرد السابق
    .join('\n')
    .replace(/^(On|في|بتاريخ)\b[\s\S]*?(wrote|كتب):[\s\S]*$/m, '')
    .replace(/\n{3,}/g, '\n\n').trim();
  return {
    from: addr,
    subject: decodeWords(headers.subject || '').trim(),
    body: text.slice(0, 2000),
    date: headers.date || '',
  };
}

// ───────── التشغيل ─────────

const csvCell = (v) => {
  const s = String(v ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return /[",]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
};

console.log(`\n${C.b}${C.c}تحويل الرسائل المحفوظة إلى ملف${C.r}`);
console.log('─'.repeat(50));

if (!existsSync(SRC) || !statSync(SRC).isDirectory()) {
  console.error(`${C.red}✗${C.r} لم أجد المجلد: ${SRC}`);
  console.error(`${C.dim}  أنشئ مجلدًا اسمه emails بجانب المشروع، واحفظ فيه رسائلك.${C.r}`);
  console.error(`${C.dim}  Gmail: افتح الرسالة ← ⋮ ← Download message${C.r}`);
  console.error(`${C.dim}  Outlook: افتح الرسالة ← ⋯ ← Download${C.r}`);
  process.exit(1);
}

const files = readdirSync(SRC).filter((f) => ['.eml', '.txt'].includes(extname(f).toLowerCase()));
if (!files.length) {
  console.error(`${C.red}✗${C.r} المجلد فارغ من ملفات .eml`);
  console.error(`${C.dim}  ${SRC}${C.r}`);
  process.exit(1);
}

const rows = [];
let failed = 0;
for (const f of files) {
  try {
    const m = parseEml(readFileSync(join(SRC, f), 'latin1'));
    if (!m.subject && !m.body) { failed++; continue; }
    rows.push(m);
  } catch { failed++; }
}

if (!rows.length) {
  console.error(`${C.red}✗${C.r} لم أستطع قراءة أي رسالة من ${files.length} ملفًا.`);
  process.exit(1);
}

// \u0644\u0627 \u0646\u0645\u062d\u0648 \u0639\u0645\u0644\u064b\u0627 \u0643\u062a\u0628\u0647 \u0627\u0644\u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u064a\u062f\u0647 \u0641\u064a \u0627\u0644\u0642\u0627\u0644\u0628
if (existsSync(OUT) && !args[1]) {
  const cur = readFileSync(OUT, 'utf8').split('\n').filter((l) => l.trim());
  const filled = cur.length > 2 || (cur[1] && !cur[1].includes('\u0627\u0646\u0633\u062e'));
  if (filled) {
    console.error(`${C.red}\u2717${C.r} \u0627\u0644\u0645\u0644\u0641 ${OUT.split(/[\\/]/).pop()} \u0641\u064a\u0647 \u0628\u064a\u0627\u0646\u0627\u062a \u2014 \u0644\u0646 \u0623\u0645\u062d\u0648\u0647\u0627.`);
    console.error(`${C.dim}  \u0627\u0643\u062a\u0628 \u0627\u0633\u0645\u064b\u0627 \u0622\u062e\u0631:  node eml-to-csv.mjs emails \u0645\u0646-\u0628\u0631\u064a\u062f\u064a.csv${C.r}`);
    process.exit(1);
  }
}

const lines = ['from,subject,body'];
for (const r of rows) lines.push([r.from, r.subject, r.body].map(csvCell).join(','));
writeFileSync(OUT, '\ufeff' + lines.join('\n'), 'utf8');

console.log(`${C.g}✓${C.r} ${rows.length} رسالة من ${files.length} ملفًا`);
if (failed) console.log(`${C.y}!${C.r} ${failed} تعذّرت قراءتها`);
console.log(`${C.g}✓${C.r} الملف: ${OUT.split(/[\\/]/).pop()}`);
console.log(`\n${C.dim}شغّل الفارز عليه:${C.r}`);
console.log(`  node sort-emails.mjs ${OUT.split(/[\\/]/).pop()}\n`);
