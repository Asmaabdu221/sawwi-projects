#!/usr/bin/env node
/**
 * release-project.mjs — أمر واحد ينشر مشروع فيديو للجمهور.
 *
 *   node scripts/release-project.mjs <slug> [خيارات]
 *
 * الخيارات:
 *   --video <رابط>     رابط الفيديو (الافتراضي: «قريبًا»)
 *   --tags "أ,ب,ج"     وسوم تظهر في صفحة الهبوط
 *   --draft            أنشئ الإصدار كمسودة لا تُنشر
 *   --no-index         لا تحدّث الفهرس ولا صفحة الهبوط
 *   --no-push          لا تدفع تحديث الفهرس إلى GitHub
 *
 * يبني ملف الإصدار من git HEAD حصرًا — لذا لا يمكن أن يتسرب إليه
 * أي ملف ناتج عن تجربة أو اختبار. إن كان المشروع غير مُودَع، يتوقف ويخبرك.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_REPO = 'Asmaabdu221/sawwi-projects';
const GH = process.env.GH_BIN || 'C:/Program Files/GitHub CLI/gh.exe';

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const toArabic = (n) => String(n).padStart(2, '0').split('').map((d) => AR_DIGITS[+d]).join('');
// للأعداد لا للترتيب — بلا تصفير في المقدّمة
const num = (n) => String(n).split('').map((d) => AR_DIGITS[+d]).join('');

function die(msg, hint) {
  console.error('\n✖ ' + msg);
  if (hint) console.error('\n  ' + hint.replace(/\n/g, '\n  '));
  console.error('');
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', shell: false, ...opts });
  if (r.error) die('تعذّر تشغيل ' + cmd + ' — ' + r.error.message);
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const git = (...args) => run('git', args);
const gh = (...args) => run(GH, args);

// ── الوسائط ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const slug = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.includes('--' + name);
const value = (name) => {
  const i = argv.indexOf('--' + name);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
};

if (!slug) {
  die('لم تحدّد المشروع.', 'مثال:\nnode scripts/release-project.mjs hr-email-sorter --video https://youtu.be/xxxx');
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
  die('اسم المشروع «' + slug + '» غير صالح.', 'حروف إنجليزية صغيرة وأرقام وشرطات فقط.');
}

const projDir = join(ROOT, 'projects', slug);
if (!existsSync(projDir)) {
  die('لا يوجد مجلد projects/' + slug, 'أنشئ المشروع أولًا ثم أودِعه في git.');
}

// ── ١) تحقّق من أن المشروع مُودَع ونظيف ──────────────────────────────────
console.log('\n▸ ' + slug);

if (git('rev-parse', '--git-dir').code !== 0) die('هذا المجلد ليس مستودع git.');

const tracked = git('ls-files', 'projects/' + slug).out.split('\n').filter(Boolean);
if (tracked.length === 0) {
  die('ملفات المشروع غير مُودَعة في git.',
    'أودِعها أولًا:\ngit add projects/' + slug + '\ngit commit -m "مشروع: ' + slug + '"');
}

const dirty = git('status', '--porcelain', '--', 'projects/' + slug).out.split('\n').filter(Boolean);
if (dirty.length) {
  die('في المشروع تعديلات غير مُودَعة — لن أبني إصدارًا من عمل غير محفوظ:\n' + dirty.join('\n'),
    'أودِعها ثم أعد الأمر:\ngit add projects/' + slug + '\ngit commit -m "تحديث ' + slug + '"');
}

// ملفّان على الأقل: سكربت ودليل
const hasScript = tracked.some((f) => /\.(mjs|js|py|ps1|sh)$/.test(f));
const hasReadme = tracked.some((f) => /README\.md$/i.test(f));
if (!hasScript) die('لا أجد سكربت تشغيل في المشروع (mjs/js/py/ps1/sh).');
if (!hasReadme) die('لا أجد README.md في المشروع — الجمهور يحتاجه.');

console.log('  ✓ مُودَع ونظيف — ' + num(tracked.length) + ' ملفات');

// ── ٢) اقرأ الاسم والوصف من دليل المشروع ────────────────────────────────
const readme = readFileSync(join(projDir, 'README.md'), 'utf8');
const nameMatch = readme.match(/^#\s+(.+?)\s*$/m);
const name = value('name') || (nameMatch && nameMatch[1].trim());
if (!name) die('لم أستطع قراءة عنوان المشروع من README.md', 'يلزم سطر يبدأ بـ# في أول الدليل.');

const linerMatch = readme.match(/^\*\*(.+?)\*\*\s*$/m);
const oneLiner = value('desc') || (linerMatch ? linerMatch[1].trim() : '');
if (!oneLiner) {
  die('لم أجد سطر الوصف في README.md',
    'يلزم سطر بين نجمتين مزدوجتين بعد العنوان، مثل:\n**يقرأ ملف الرسائل ويصنّفها.**');
}

console.log('  ✓ ' + name);

// ── ٣) ابنِ ملف الإصدار من HEAD ─────────────────────────────────────────
const relDir = join(ROOT, 'releases');
mkdirSync(relDir, { recursive: true });
const zip = join(relDir, slug + '.zip');

const arch = git('archive', '--format=zip', '--prefix=' + slug + '/', '-o', zip, 'HEAD:projects/' + slug);
if (arch.code !== 0) die('فشل بناء ملف الإصدار.\n' + arch.err);

const kb = Math.round(statSync(zip).size / 1024);
console.log('  ✓ releases/' + slug + '.zip — ' + num(kb) + ' كِ.بايت من HEAD');

// ── ٤) تحقّق من gh ثم أنشئ الإصدار أو حدّثه ─────────────────────────────
if (gh('auth', 'status').code !== 0) {
  die('GitHub CLI غير مصادَق.',
    'شغّل: gh auth login  ثم أعد الأمر.\nملف الإصدار جاهز في releases/ إن أردت رفعه يدويًا.');
}

const notes = [
  '**' + oneLiner + '**',
  '',
  '### التشغيل',
  '```bash',
  'npm install -g @anthropic-ai/claude-code',
  'claude            # سجّل الدخول باشتراكك مرة واحدة',
  'unzip ' + slug + '.zip && cd ' + slug,
  '```',
  'ثم اتبع دليل المشروع — فيه أمر التشغيل وبيانات المثال.',
  '',
  '### المتطلبات',
  '- Node ٢٠ أو أحدث',
  '- اشتراك Claude — **بلا مفتاح API وبلا رصيد مدفوع**',
  '',
  '### الخصوصية',
  'ما تعطيه للمشروع يُرسل إلى Claude كما لو لصقته في المحادثة. جرّبه على بيانات المثال أولًا، وراجع سياسة شركتك قبل بيانات العمل الحقيقية.',
  '',
  '---',
  'دليل المشروع: https://github.com/' + OWNER_REPO + '/tree/main/projects/' + slug,
].join('\n');

const notesFile = join(relDir, '.' + slug + '.notes.md');
writeFileSync(notesFile, notes, 'utf8');

const exists = gh('release', 'view', slug, '--repo', OWNER_REPO, '--json', 'tagName').code === 0;

if (exists) {
  const up = gh('release', 'upload', slug, zip, '--repo', OWNER_REPO, '--clobber');
  if (up.code !== 0) die('فشل رفع الملف إلى الإصدار القائم.\n' + up.err);
  const ed = gh('release', 'edit', slug, '--repo', OWNER_REPO, '--title', name, '--notes-file', notesFile);
  if (ed.code !== 0) die('فشل تحديث وصف الإصدار.\n' + ed.err);
  console.log('  ✓ حُدّث الإصدار القائم — استُبدل الملف');
} else {
  const args = ['release', 'create', slug, zip, '--repo', OWNER_REPO, '--title', name, '--notes-file', notesFile];
  if (flag('draft')) args.push('--draft');
  const cr = gh(...args);
  if (cr.code !== 0) die('فشل إنشاء الإصدار.\n' + cr.err);
  console.log('  ✓ أُنشئ الإصدار' + (flag('draft') ? ' (مسودة)' : ''));
}

const relUrl = 'https://github.com/' + OWNER_REPO + '/releases/tag/' + slug;
const treeUrl = 'https://github.com/' + OWNER_REPO + '/tree/main/projects/' + slug;

// ── ٥) حدّث الفهرس وصفحة الهبوط ─────────────────────────────────────────
const touched = [];

if (!flag('no-index')) {
  const video = value('video');
  const videoCell = video ? '[شاهد](' + video + ')' : 'قريبًا';

  // README.md — جدول المشاريع
  const readmePath = join(ROOT, 'README.md');
  let idx = readFileSync(readmePath, 'utf8');

  if (idx.includes('](projects/' + slug + '/)')) {
    console.log('  · الفهرس: المشروع مدرج مسبقًا');
  } else {
    const count = (idx.match(/\]\(projects\/[^)]+\/\)/g) || []).length;
    const row = '| ' + toArabic(count + 1) + ' | [' + name + '](projects/' + slug + '/) | ' +
      oneLiner.replace(/\|/g, '\\|') + ' | ' + videoCell + ' | [⬇️](' + relUrl + ') |';
    const anchor = '\n> يكبر هذا الجدول';
    if (!idx.includes(anchor)) die('لم أجد موضع الإدراج في README.md');
    idx = idx.replace(anchor, '\n' + row + '\n' + anchor);
    writeFileSync(readmePath, idx, 'utf8');
    touched.push('README.md');
    console.log('  ✓ الفهرس: أُضيف صفّ ' + toArabic(count + 1));
  }

  // docs/index.html — معرض البطاقات
  const pagePath = join(ROOT, 'docs', 'index.html');
  if (existsSync(pagePath)) {
    let page = readFileSync(pagePath, 'utf8');
    if (page.includes('projects/' + slug + '"')) {
      console.log('  · صفحة الهبوط: البطاقة موجودة مسبقًا');
    } else {
      const n = (page.match(/class="card-n"/g) || []).length;
      const tags = (value('tags') || '').split(',').map((t) => t.trim()).filter(Boolean);
      const tagHtml = tags.length
        ? '\n          <div class="tags">\n' +
          tags.map((t, i) => '            <span class="tag' + (i === 0 ? ' ok' : '') + '">' + t + '</span>').join('\n') +
          '\n          </div>'
        : '';
      const card =
        '      <article class="card">\n' +
        '        <span class="card-n">' + toArabic(n + 1) + '</span>\n' +
        '        <div>\n' +
        '          <h3><a href="' + treeUrl + '">' + name + '</a></h3>\n' +
        '          <p>' + oneLiner + '</p>' + tagHtml + '\n' +
        '        </div>\n' +
        '        <a class="dl" href="' + relUrl + '">\n' +
        '          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">\n' +
        '            <path d="M12 3v12m0 0 4-4m-4 4-4-4M4 19h16"/>\n' +
        '          </svg>\n' +
        '          تحميل\n' +
        '        </a>\n' +
        '      </article>\n';
      const anchor = '    </div>\n\n    <div class="next">';
      if (!page.includes(anchor)) {
        console.log('  ! صفحة الهبوط: لم أجد موضع البطاقة — أضفها يدويًا');
      } else {
        page = page.replace(anchor, card + anchor);
        writeFileSync(pagePath, page, 'utf8');
        touched.push('docs/index.html');
        console.log('  ✓ صفحة الهبوط: أُضيفت بطاقة ' + toArabic(n + 1));
      }
    }
  }
}

// ── ٦) أودِع تحديث الفهرس وادفعه ────────────────────────────────────────
if (touched.length && !flag('no-push')) {
  git('add', ...touched);
  const cm = git('commit', '-m', 'فهرس: ' + name);
  if (cm.code !== 0) {
    console.log('  ! تعذّر الإيداع — أودِع يدويًا');
  } else {
    const ps = git('push');
    console.log(ps.code === 0 ? '  ✓ دُفع تحديث الفهرس' : '  ! فشل الدفع — شغّل: git push');
  }
}

console.log('\n  ' + relUrl + '\n');
