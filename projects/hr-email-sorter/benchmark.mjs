#!/usr/bin/env node
/**
 * يقيس دقة المحرّكات على `benchmark-emails.csv` — اثنتا عشرة رسالة
 * مع الجواب الصحيح لكل واحدة في عمود `expected`.
 *
 * هذه هي الأرقام المنشورة في الدليل. شغّله بنفسك وتأكد منها.
 *
 *   node benchmark.mjs                      ← القواعد وحدها (فوري)
 *   node benchmark.mjs rules ollama claude  ← قارن ما تشاء
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, findClaude, ollamaModels } from './engines.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CFG = JSON.parse(readFileSync(join(HERE, 'categories.json'), 'utf8'));
const C = { r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m', g: '\x1b[32m', y: '\x1b[33m', red: '\x1b[31m', c: '\x1b[36m' };

const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ENGINES = want.length ? want : ['rules'];

// قراءة CSV بسيطة — لا فواصل داخل الحقول في ملف المقياس
const rows = readFileSync(join(HERE, 'benchmark-emails.csv'), 'utf8')
  .split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
const head = rows[0].split(',');
const [iF, iS, iB, iE] = ['from', 'subject', 'body', 'expected'].map((k) => head.indexOf(k));
const data = rows.slice(1).map((l) => {
  const c = l.split(',');
  return { from: c[iF], subject: c[iS], body: c[iB], expected: c[iE].trim() };
});

console.log(`\n${C.b}${C.c}مقياس فارز بريد الموارد البشرية${C.r}`);
console.log(`${C.dim}${data.length} رسالة · الجواب الصحيح معروف لكل واحدة${C.r}`);
console.log('═'.repeat(58));

const table = [];

for (const name of ENGINES) {
  let engine;
  if (name === 'rules') engine = { name: 'rules' };
  else if (name === 'ollama') {
    const models = await ollamaModels();
    if (!models?.length) { console.log(`\n${C.y}تخطّيت ollama${C.r} — الخادم لا يعمل`); continue; }
    const w = CFG.ollamaModel;
    engine = { name: 'ollama', model: models.find((m) => m === w || m.startsWith(w.split(':')[0])) || models[0] };
  } else if (name === 'claude') {
    const bin = findClaude();
    if (!bin) { console.log(`\n${C.y}تخطّيت claude${C.r} — غير مثبّت`); continue; }
    engine = { name: 'claude', bin };
  } else { console.log(`${C.red}محرّك مجهول: ${name}${C.r}`); continue; }

  const label = engine.name === 'ollama' ? `ollama · ${engine.model}` : engine.name;
  console.log(`\n${C.b}▸ ${label}${C.r}`);

  const t0 = Date.now();
  const res = await classify(engine, data, CFG, {
    onProgress: (n, t) => process.stdout.write(`\r${C.dim}  ${n}/${t}${C.r}   `),
  });
  const secs = (Date.now() - t0) / 1000;
  process.stdout.write('\r' + ' '.repeat(20) + '\r');

  let right = 0, silent = 0;
  for (const r of res) {
    const e = data[r.index];
    const ok = r.category === e.expected;
    if (ok) { right++; continue; }
    // خطأ صامت: أخطأ ولم يحذّرك
    const loud = r.confidence === 'منخفضة';
    if (!loud) silent++;
    console.log(`  ${loud ? C.y + '!' : C.red + '✗'}${C.r} ${String(e.subject).slice(0, 26).padEnd(28)} ` +
                `${C.dim}الصواب${C.r} ${e.expected.padEnd(8)} ${C.dim}قال${C.r} ${r.category}` +
                `${loud ? C.dim + '  (حذّر)' + C.r : C.red + '  (صامت)' + C.r}`);
  }

  console.log(`  ${C.g}✓${C.r} ${C.b}${right}/${data.length}${C.r} صحيحة · ` +
              `${silent ? C.red : C.g}${silent}${C.r} خطأ صامت · ${secs.toFixed(1)} ثانية`);
  table.push({ label, right, silent, secs });
}

if (table.length > 1) {
  console.log('\n' + '═'.repeat(58));
  console.log(`${C.b}${'المحرّك'.padEnd(26)}${'صحيحة'.padEnd(10)}${'صامتة'.padEnd(10)}الزمن${C.r}`);
  for (const t of table) {
    console.log(`${t.label.slice(0, 24).padEnd(26)}${(t.right + '/' + data.length).padEnd(11)}` +
                `${String(t.silent).padEnd(11)}${t.secs.toFixed(1)} ث`);
  }
}
console.log('');
