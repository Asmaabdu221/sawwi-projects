#!/usr/bin/env node
/**
 * فارز بريد الموارد البشرية
 *
 * يقرأ ملف رسائل، يصنّفها إلى فئات، ويكتب النتيجة في ملف جاهز للفتح في Excel.
 *
 * ثلاثة محرّكات — يختار المتاح تلقائيًا:
 *   rules   مجاني · فوري · بلا إنترنت · لا يحتاج أي تثبيت
 *   ollama  مجاني · نموذج على جهازك · بياناتك لا تغادره
 *   claude  اشتراك Claude · أعلى جودة · يكتب مسودات الردود
 *
 * التشغيل:
 *   node sort-emails.mjs                      ← بيانات المثال، محرّك تلقائي
 *   node sort-emails.mjs my-emails.csv        ← ملفك
 *   node sort-emails.mjs --engine rules       ← اختر محرّكًا بنفسك
 *   node sort-emails.mjs --drafts             ← مع مسودات الردود
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectEngine, classify, findClaude, ollamaModels } from './engines.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const WITH_DRAFTS = args.includes('--drafts');

// الخيارات التي تأخذ قيمة بعدها — حتى لا تُحسَب قيمتُها اسمَ ملف
const VALUE_FLAGS = ['engine', 'model'];

const flagValue = (name) => {
  const i = args.indexOf('--' + name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};

const consumed = new Set();
for (const f of VALUE_FLAGS) {
  const i = args.indexOf('--' + f);
  if (i !== -1 && args[i + 1] && !args[i + 1].startsWith('--')) consumed.add(i + 1);
}
const INPUT = args.find((a, i) => !a.startsWith('--') && !consumed.has(i)) || join(HERE, 'sample-emails.csv');

const CFG = JSON.parse(readFileSync(join(HERE, 'categories.json'), 'utf8'));
const KEYS = CFG.categories.map((c) => c.key);

const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', red: '\x1b[31m', c: '\x1b[36m' };

const ENGINE_LABEL = {
  rules: 'قواعد محلية — مجاني، بلا إنترنت، لا يغادر جهازك',
  ollama: 'نموذج على جهازك — مجاني، بياناتك لا تغادره',
  claude: 'اشتراك Claude — أعلى جودة',
};

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

// ───────────────── اختيار المحرّك ─────────────────
async function pickEngine() {
  const want = flagValue('engine') || CFG.engine || 'auto';

  if (want === 'rules') return { name: 'rules' };

  if (want === 'ollama') {
    const models = await ollamaModels();
    if (!models || !models.length) {
      console.error(`${C.red}✗${C.r} Ollama لا يعمل أو لا نماذج فيه.`);
      console.error(`  شغّله:  ollama serve      ثم:  ollama pull ${CFG.ollamaModel || 'qwen3:4b'}`);
      console.error(`  أو استخدم المحرّك المجاني الفوري:  node sort-emails.mjs --engine rules`);
      process.exit(1);
    }
    const w = flagValue('model') || CFG.ollamaModel;
    const found = w && models.find((m) => m === w || m.startsWith(w.split(':')[0]));
    if (w && !found) {
      console.error(`${C.red}✗${C.r} النموذج «${w}» غير منزّل. الموجود: ${models.join('، ')}`);
      console.error(`  نزّله:  ollama pull ${w}`);
      process.exit(1);
    }
    return { name: 'ollama', model: found || models[0] };
  }

  if (want === 'claude') {
    const bin = findClaude();
    if (!bin) {
      console.error(`${C.red}✗${C.r} لم أجد claude. يلزمه اشتراك Claude مدفوع — أو جرّب:`);
      console.error(`  node sort-emails.mjs --engine rules     ← مجاني وفوري`);
      process.exit(1);
    }
    return { name: 'claude', bin };
  }

  return detectEngine(CFG);
}

// ───────────────── التشغيل ─────────────────
(async () => {
  console.log(`\n${C.b}${C.c}فارز بريد الموارد البشرية${C.r}`);
  console.log('─'.repeat(54));

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

  const engine = await pickEngine();
  const engineName = engine.name === 'ollama' ? `ollama · ${engine.model}` : engine.name;

  console.log(`الملف   : ${INPUT.split(/[\\/]/).pop()}`);
  console.log(`الرسائل : ${emails.length}`);
  console.log(`الفئات  : ${KEYS.join(' · ')}`);
  console.log(`المحرّك  : ${C.b}${engineName}${C.r}`);
  console.log(`${C.dim}${ENGINE_LABEL[engine.name]}${C.r}\n`);

  if (WITH_DRAFTS && engine.name === 'rules') {
    console.log(`${C.y}!${C.r} محرّك القواعد لا يكتب مسودات — يحتاج ollama أو claude.\n`);
  }

  const t0 = Date.now();
  let results;
  try {
    results = await classify(engine, emails, CFG, {
      withDrafts: WITH_DRAFTS,
      onProgress: (n, total) => process.stdout.write(`\r${C.dim}يصنّف... ${n}/${total}${C.r}   `),
    });
  } catch (e) {
    console.error(`\n${C.red}✗${C.r} ${e.message}`);
    console.error(`${C.dim}جرّب المحرّك المجاني الفوري:  node sort-emails.mjs --engine rules${C.r}`);
    process.exit(1);
  }
  if (engine.name === 'ollama') process.stdout.write('\r' + ' '.repeat(40) + '\r');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // ── العرض ──
  const byCat = {};
  for (const r of results) (byCat[r.category] ||= []).push(r);

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

  console.log('─'.repeat(54));
  console.log(`${C.g}✓${C.r} ${results.length} رسالة في ${secs} ثانية ${C.dim}(${engineName})${C.r}`);
  if (urgent) console.log(`${C.y}⚡${C.r} ${urgent} عاجلة تحتاج ردًا اليوم`);
  if (low) console.log(`${C.y}!${C.r} ${low} تحتاج مراجعتك — الثقة منخفضة`);
  console.log(`${C.g}✓${C.r} الملف: sorted-emails.csv ${C.dim}(افتحه بـExcel)${C.r}`);
  if (!WITH_DRAFTS && engine.name !== 'rules') {
    console.log(`\n${C.dim}للحصول على مسودات ردود:  node sort-emails.mjs --drafts${C.r}`);
  }
})();
