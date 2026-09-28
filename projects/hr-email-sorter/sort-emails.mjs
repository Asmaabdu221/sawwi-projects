#!/usr/bin/env node
/**
 * فارز بريد الموارد البشرية
 *
 * يقرأ ملف رسائل، يصنّفها إلى فئات، ويكتب النتيجة في ملف جاهز للفتح في Excel.
 * يشتغل باشتراك Claude المدفوع عبر `claude -p` — بلا مفتاح API وبلا تكلفة إضافية.
 *
 * التشغيل:
 *   node sort-emails.mjs                      ← على بيانات المثال
 *   node sort-emails.mjs my-emails.csv        ← على ملفك
 *   node sort-emails.mjs --drafts             ← مع مسودات الردود
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, homedir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const WITH_DRAFTS = args.includes('--drafts');
const INPUT = args.find((a) => !a.startsWith('--')) || join(HERE, 'sample-emails.csv');

const CFG = JSON.parse(readFileSync(join(HERE, 'categories.json'), 'utf8'));
const KEYS = CFG.categories.map((c) => c.key);

const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', red: '\x1b[31m', c: '\x1b[36m' };

// ───────────────── إيجاد claude ─────────────────
function findClaude() {
  const isWin = platform() === 'win32';
  const cands = [
    process.env.APPDATA && join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', isWin ? 'claude.exe' : 'claude'),
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude',
    join(homedir(), '.local', 'bin', 'claude'),
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  return 'claude';
}
const CLAUDE = findClaude();

// ───────────────── قراءة CSV ─────────────────
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

const csvCell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
};

// ───────────────── المخطط ─────────────────
const SCHEMA = {
  type: 'object',
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'category', 'confidence', 'reason', 'urgent'],
        properties: {
          index: { type: 'integer' },
          category: { type: 'string', enum: KEYS },
          confidence: { type: 'string', enum: ['عالية', 'متوسطة', 'منخفضة'] },
          reason: { type: 'string' },
          urgent: { type: 'boolean' },
          draft: { type: 'string' },
        },
      },
    },
  },
};

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE, [
      '-p', prompt, '--model', 'sonnet',
      '--output-format', 'json',
      '--json-schema', JSON.stringify(SCHEMA),
    ], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const kill = setTimeout(() => child.kill('SIGTERM'), 5 * 60_000);
    child.on('close', (code) => {
      clearTimeout(kill);
      if (code !== 0) return reject(new Error(err.slice(0, 200) || `claude exit ${code}`));
      try {
        const d = JSON.parse(out);
        if (d.is_error) return reject(new Error(d.result));
        if (!d.structured_output) return reject(new Error('لم يرجع مخرَجًا منظَّمًا'));
        resolve(d.structured_output.results || []);
      } catch (e) { reject(new Error('تعذّر تحليل المخرَج: ' + e.message)); }
    });
    child.on('error', () => reject(new Error(`لم أجد الأمر claude. ثبّته:  npm install -g @anthropic-ai/claude-code`)));
  });
}

function buildPrompt(emails) {
  const cats = CFG.categories.map((c) => `- ${c.key}: ${c.desc}`).join('\n');
  const list = emails.map((e, i) =>
    `[${i}] من: ${e.from}\n    الموضوع: ${e.subject}\n    النص: ${String(e.body).slice(0, 400)}`).join('\n\n');

  return `أنت مساعد فرز بريد في إدارة موارد بشرية بشركة سعودية.

صنّف كل رسالة إلى فئة واحدة فقط:
${cats}

قواعد:
- اختر الفئة التي تحدد **الإجراء المطلوب**، لا الموضوع الظاهري.
- الشكاوى والمواضيع الحساسة تذهب إلى «شكوى» دائمًا — ولا تكتب لها مسودة رد.
- urgent = true إذا كانت الرسالة تحتاج ردًا خلال ٢٤ ساعة (كلمات مثل: ${CFG.urgentWords.join('، ')}، أو موعد قريب).
- confidence: «منخفضة» إن كانت الرسالة مبهمة أو تحتمل فئتين — الصراحة أنفع من التخمين.
- reason: سبب موجز في سطر واحد.
${WITH_DRAFTS ? '- draft: مسودة رد رسمية بالعربية الفصحى المبسّطة، ثلاثة أسطر كحد أقصى، للفئات التي تستحق ردًا فقط. اتركها فارغة للشكاوى.' : '- لا تكتب draft.'}

الرسائل:

${list}

أعد التصنيف لكل رسالة بترتيب الفهرس نفسه.`;
}

// ───────────────── التشغيل ─────────────────
(async () => {
  console.log(`\n${C.b}${C.c}فارز بريد الموارد البشرية${C.r}`);
  console.log('─'.repeat(52));

  if (!existsSync(INPUT)) {
    console.error(`${C.red}✗${C.r} لم أجد الملف: ${INPUT}`);
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(INPUT, 'utf8'));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iFrom = header.indexOf('from'), iSubj = header.indexOf('subject'), iBody = header.indexOf('body');
  if (iSubj < 0) {
    console.error(`${C.red}✗${C.r} الملف يحتاج أعمدة: from, subject, body`);
    process.exit(1);
  }

  const emails = rows.slice(1).map((r) => ({
    from: r[iFrom] || '', subject: r[iSubj] || '', body: r[iBody] || '',
  }));

  console.log(`الملف   : ${INPUT.split(/[\\/]/).pop()}`);
  console.log(`الرسائل : ${emails.length}`);
  console.log(`الفئات  : ${KEYS.join(' · ')}`);
  console.log(`${C.dim}يشتغل باشتراك Claude المدفوع — بلا مفتاح API${C.r}\n`);

  const t0 = Date.now();
  let results;
  try {
    results = await runClaude(buildPrompt(emails));
  } catch (e) {
    console.error(`${C.red}✗${C.r} ${e.message}`);
    process.exit(1);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // ── العرض ──
  const counts = {};
  const byCat = {};
  for (const r of results) {
    counts[r.category] = (counts[r.category] || 0) + 1;
    (byCat[r.category] ||= []).push(r);
  }

  for (const key of KEYS) {
    const items = byCat[key];
    if (!items) continue;
    console.log(`${C.b}${key}${C.r} ${C.dim}(${items.length})${C.r}`);
    for (const r of items) {
      const e = emails[r.index] || {};
      const flag = r.urgent ? `${C.y}⚡${C.r} ` : '   ';
      const conf = r.confidence === 'منخفضة' ? `${C.y}[${r.confidence}]${C.r}` : `${C.dim}[${r.confidence}]${C.r}`;
      console.log(`  ${flag}${String(e.subject).slice(0, 44).padEnd(46)} ${conf}`);
      if (r.confidence === 'منخفضة') console.log(`      ${C.dim}${r.reason}${C.r}`);
    }
    console.log('');
  }

  // ── الحفظ ──
  const cols = ['from', 'subject', 'category', 'urgent', 'confidence', 'reason'];
  if (WITH_DRAFTS) cols.push('draft');
  const lines = [cols.join(',')];
  for (const r of results) {
    const e = emails[r.index] || {};
    const row = [e.from, e.subject, r.category, r.urgent ? 'عاجل' : '', r.confidence, r.reason];
    if (WITH_DRAFTS) row.push(r.draft || '');
    lines.push(row.map(csvCell).join(','));
  }
  const out = join(HERE, 'sorted-emails.csv');
  writeFileSync(out, '﻿' + lines.join('\n'), 'utf8');

  const urgent = results.filter((r) => r.urgent).length;
  const low = results.filter((r) => r.confidence === 'منخفضة').length;

  console.log('─'.repeat(52));
  console.log(`${C.g}✓${C.r} ${results.length} رسالة في ${secs} ثانية`);
  if (urgent) console.log(`${C.y}⚡${C.r} ${urgent} عاجلة تحتاج ردًا اليوم`);
  if (low) console.log(`${C.y}!${C.r} ${low} تحتاج مراجعتك — الثقة منخفضة`);
  console.log(`${C.g}✓${C.r} الملف: sorted-emails.csv ${C.dim}(افتحه بـExcel)${C.r}`);
  if (!WITH_DRAFTS) console.log(`\n${C.dim}للحصول على مسودات ردود:  node sort-emails.mjs --drafts${C.r}`);
})();
