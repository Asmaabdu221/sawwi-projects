/**
 * محرّكات التصنيف الثلاثة.
 *
 *   rules   — قواعد وكلمات مفتاحية. مجاني · فوري · بلا إنترنت · لا يغادر جهازك.
 *   ollama  — نموذج يعمل على جهازك. مجاني · خاص · ذكاء حقيقي.
 *   claude  — اشتراك Claude. أعلى جودة، ويكتب مسودات الردود.
 *
 * الاكتشاف التلقائي: ollama ← claude ← rules.
 * كلٌّ منها يرجّع الشكل نفسه، فبقية المشروع لا تعرف أيُّها اشتغل.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { platform, homedir } from 'node:os';

const OLLAMA_URL = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';

// ═══════════════════ أدوات عربية ═══════════════════

/** يوحّد صور الحرف العربي حتى تتطابق «إجازة» و«اجازه» و«أجازة». */
export function normalize(s) {
  return String(s ?? '')
    .replace(/[ً-ْـٰ]/g, '')   // تشكيل وتطويل
    .replace(/[أإآٱ]/g, 'ا') // أ إ آ ٱ ← ا
    .replace(/ى/g, 'ي')                   // ى ← ي
    .replace(/ة/g, 'ه')                   // ة ← ه
    .replace(/ؤ/g, 'و')                   // ؤ ← و
    .replace(/ئ/g, 'ي')                   // ئ ← ي
    .replace(/[^ء-ي0-9a-zA-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ═══════════════════ الاكتشاف ═══════════════════

export function findClaude() {
  const isWin = platform() === 'win32';
  const cands = [
    join(homedir(), '.local', 'bin', isWin ? 'claude.exe' : 'claude'),
    process.env.APPDATA && join(process.env.APPDATA, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', isWin ? 'claude.exe' : 'claude'),
    '/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude',
    join(homedir(), '.npm-global', 'bin', 'claude'),
  ].filter(Boolean);
  for (const c of cands) if (existsSync(c)) return c;
  return null;
}

/** هل خادم Ollama يعمل؟ وإن عمل، ما النماذج الموجودة؟ */
export async function ollamaModels() {
  try {
    const ctl = AbortSignal.timeout(2500);
    const r = await fetch(OLLAMA_URL + '/api/tags', { signal: ctl });
    if (!r.ok) return null;
    const d = await r.json();
    return (d.models || []).map((m) => m.name);
  } catch { return null; }
}

/** يختار المحرّك: ollama إن كان يعمل، ثم claude، ثم القواعد. */
export async function detectEngine(cfg) {
  const models = await ollamaModels();
  if (models && models.length) {
    const want = cfg.ollamaModel;
    const model = (want && models.find((m) => m === want || m.startsWith(want.split(':')[0]))) || models[0];
    return { name: 'ollama', model };
  }
  const claude = findClaude();
  if (claude) return { name: 'claude', bin: claude };
  return { name: 'rules' };
}

// ═══════════════════ ١) محرّك القواعد ═══════════════════

/**
 * يطابق كلمات الفئة على العنوان والنص. العنوان يزن ثلاثة أضعاف
 * لأن موضوع الرسالة يحمل نيّتها عادةً.
 */
export function classifyRules(emails, cfg) {
  const cats = cfg.categories.map((c) => ({
    key: c.key,
    words: (c.words || []).map(normalize).filter(Boolean),
  }));
  const fallback = cfg.categories[cfg.categories.length - 1].key;
  const urgentWords = (cfg.urgentWords || []).map(normalize);

  return emails.map((e, index) => {
    const subj = normalize(e.subject);
    const body = normalize(e.body);

    let best = { key: fallback, score: 0, hits: [] };
    let second = 0;

    for (const c of cats) {
      let score = 0;
      const hits = [];
      for (const w of c.words) {
        if (!w) continue;
        if (subj.includes(w)) { score += 3; hits.push(w); }
        else if (body.includes(w)) { score += 1; hits.push(w); }
      }
      if (score > best.score) { second = best.score; best = { key: c.key, score, hits }; }
      else if (score > second) second = score;
    }

    let confidence;
    if (best.score === 0) confidence = 'منخفضة';
    else if (best.score >= 6 && second < best.score * 0.6) confidence = 'عالية';
    else if (best.score >= 3) confidence = 'متوسطة';
    else confidence = 'منخفضة';

    const urgent = urgentWords.some((w) => w && (subj.includes(w) || body.includes(w)));

    const reason = best.score === 0
      ? 'لا كلمة من أي فئة — راجعها بنفسك'
      : 'طابقت: ' + [...new Set(best.hits)].slice(0, 3).join('، ');

    return { index, category: best.key, confidence, reason, urgent, draft: '' };
  });
}

// ═══════════════════ ٢) محرّك Ollama ═══════════════════

/** ينزع كتلة التفكير التي تصدرها بعض النماذج، ثم يلتقط أول كائن JSON. */
function extractJson(text) {
  let t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const start = t.indexOf('{');
  if (start === -1) throw new Error('لا JSON في الرد');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error('JSON ناقص');
}

function oneSchema(keys, withDrafts) {
  const props = {
    category: { type: 'string', enum: keys },
    confidence: { type: 'string', enum: ['عالية', 'متوسطة', 'منخفضة'] },
    reason: { type: 'string' },
    urgent: { type: 'boolean' },
  };
  if (withDrafts) props.draft = { type: 'string' };
  return { type: 'object', required: ['category', 'confidence', 'reason', 'urgent'], properties: props };
}

/**
 * رسالة واحدة لكل طلب. النماذج الصغيرة تلتزم بالمخطط أفضل حين
 * تُسأل عن شيء واحد، والبطء المضاف أرخص من نتيجة فاسدة.
 */
export async function classifyOllama(emails, cfg, { model, withDrafts, onProgress }) {
  const keys = cfg.categories.map((c) => c.key);
  const schema = oneSchema(keys, withDrafts);
  const cats = cfg.categories.map((c) => '- ' + c.key + ': ' + c.desc).join('\n');
  const out = [];

  for (let i = 0; i < emails.length; i++) {
    const e = emails[i];
    const sys = 'أنت مساعد فرز بريد في إدارة موارد بشرية بشركة سعودية. أجب بـJSON فقط.';
    const user =
      'صنّف هذه الرسالة إلى فئة واحدة:\n' + cats + '\n\n' +
      'قواعد:\n' +
      '- اختر الفئة حسب الإجراء المطلوب لا الموضوع الظاهري.\n' +
      '- الشكاوى والمواضيع الحساسة ← «شكوى» دائمًا.\n' +
      '- urgent = true إن احتاجت ردًا خلال ٢٤ ساعة.\n' +
      '- confidence = «منخفضة» إن كانت مبهمة أو تحتمل فئتين.\n' +
      '- reason سطر واحد موجز.\n' +
      (withDrafts ? '- draft: مسودة رد رسمية ثلاثة أسطر، واتركها فارغة للشكوى.\n' : '') +
      '\nمن: ' + e.from + '\nالموضوع: ' + e.subject + '\nالنص: ' + String(e.body).slice(0, 700);

    let parsed;
    try {
      const r = await fetch(OLLAMA_URL + '/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model,
          stream: false,
          think: false,
          format: schema,
          options: { temperature: 0, num_ctx: 4096 },
          messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
        }),
        signal: AbortSignal.timeout(180_000),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      parsed = extractJson(d.message?.content);
    } catch (err) {
      parsed = { category: keys[keys.length - 1], confidence: 'منخفضة', urgent: false,
                 reason: 'تعذّر تصنيفها آليًا (' + err.message + ') — راجعها بنفسك' };
    }

    if (!keys.includes(parsed.category)) {
      parsed.category = keys[keys.length - 1];
      parsed.confidence = 'منخفضة';
    }
    out.push({
      index: i,
      category: parsed.category,
      confidence: parsed.confidence || 'منخفضة',
      reason: parsed.reason || '',
      urgent: parsed.urgent === true,
      draft: parsed.draft || '',
    });
    if (onProgress) onProgress(i + 1, emails.length);
  }
  return out;
}

// ═══════════════════ ٣) محرّك Claude ═══════════════════

export function classifyClaude(emails, cfg, { bin, withDrafts, model = 'sonnet' }) {
  const keys = cfg.categories.map((c) => c.key);
  const schema = {
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
            category: { type: 'string', enum: keys },
            confidence: { type: 'string', enum: ['عالية', 'متوسطة', 'منخفضة'] },
            reason: { type: 'string' },
            urgent: { type: 'boolean' },
            draft: { type: 'string' },
          },
        },
      },
    },
  };

  const cats = cfg.categories.map((c) => '- ' + c.key + ': ' + c.desc).join('\n');
  const list = emails.map((e, i) =>
    '[' + i + '] من: ' + e.from + '\n    الموضوع: ' + e.subject +
    '\n    النص: ' + String(e.body).slice(0, 400)).join('\n\n');

  const prompt =
    'أنت مساعد فرز بريد في إدارة موارد بشرية بشركة سعودية.\n\n' +
    'صنّف كل رسالة إلى فئة واحدة فقط:\n' + cats + '\n\n' +
    'قواعد:\n' +
    '- اختر الفئة التي تحدد **الإجراء المطلوب**، لا الموضوع الظاهري.\n' +
    '- الشكاوى والمواضيع الحساسة تذهب إلى «شكوى» دائمًا — ولا تكتب لها مسودة رد.\n' +
    '- urgent = true إذا كانت الرسالة تحتاج ردًا خلال ٢٤ ساعة (كلمات مثل: ' +
      (cfg.urgentWords || []).join('، ') + '، أو موعد قريب).\n' +
    '- confidence: «منخفضة» إن كانت الرسالة مبهمة أو تحتمل فئتين — الصراحة أنفع من التخمين.\n' +
    '- reason: سبب موجز في سطر واحد.\n' +
    (withDrafts
      ? '- draft: مسودة رد رسمية بالعربية الفصحى المبسّطة، ثلاثة أسطر كحد أقصى، للفئات التي تستحق ردًا فقط. اتركها فارغة للشكاوى.\n'
      : '- لا تكتب draft.\n') +
    '\nالرسائل:\n\n' + list +
    '\n\nأعد التصنيف لكل رسالة بترتيب الفهرس نفسه.';

  return new Promise((resolve, reject) => {
    const child = spawn(bin, [
      '-p', prompt, '--model', model,
      '--output-format', 'json',
      '--json-schema', JSON.stringify(schema),
    ], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });

    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const kill = setTimeout(() => child.kill('SIGTERM'), 5 * 60_000);

    child.on('close', (code) => {
      clearTimeout(kill);
      if (code !== 0) return reject(new Error(err.slice(0, 200) || 'claude exit ' + code));
      try {
        const d = JSON.parse(out);
        if (d.is_error) return reject(new Error(d.result));
        if (!d.structured_output) return reject(new Error('لم يرجع مخرَجًا منظَّمًا'));
        resolve(d.structured_output.results || []);
      } catch (e) { reject(new Error('تعذّر تحليل المخرَج: ' + e.message)); }
    });
    child.on('error', () => reject(new Error('تعذّر تشغيل claude')));
  });
}

// ═══════════════════ الواجهة الموحّدة ═══════════════════

/** هل الرسالة عاجلة؟ مطابقة كلمات صريحة — لا تحتاج نموذجًا. */
export function isUrgent(email, cfg) {
  const words = (cfg.urgentWords || []).map(normalize).filter(Boolean);
  const hay = normalize(email.subject) + ' ' + normalize(email.body);
  return words.some((w) => hay.includes(w));
}

export async function classify(engine, emails, cfg, opts = {}) {
  let results;
  if (engine.name === 'rules') results = classifyRules(emails, cfg);
  else if (engine.name === 'ollama') results = await classifyOllama(emails, cfg, { ...opts, model: engine.model });
  else if (engine.name === 'claude') results = await classifyClaude(emails, cfg, { ...opts, bin: engine.bin });
  else throw new Error('محرّك غير معروف: ' + engine.name);

  // الاستعجال مسألة كلمات صريحة لا استنتاج. النماذج تسهو عنه،
  // والمطابقة لا تسهو — فنأخذها منها دائمًا ونضمّها لرأي النموذج.
  for (const r of results) {
    const e = emails[r.index];
    if (e && isUrgent(e, cfg)) r.urgent = true;
  }
  return results;
}
