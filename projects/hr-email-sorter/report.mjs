/**
 * يبني تقرير HTML يُفتح في المتصفح.
 *
 * لماذا؟ طرفية ويندوز — الكلاسيكية والحديثة — تعكس العربية وتفصل حروفها،
 * فـ«نقاش ضروري» تظهر «يرورض شاقن». المتصفح يعرضها سليمة.
 */

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const AR = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
const num = (n) => String(n).split('').map((d) => (AR[+d] ?? d)).join('');

export function buildReport({ emails, results, keys, engineLabel, secs, withDrafts }) {
  const byCat = {};
  for (const r of results) (byCat[r.category] ||= []).push(r);

  const urgent = results.filter((r) => r.urgent).length;
  const low = results.filter((r) => r.confidence === 'منخفضة').length;
  const drafted = results.filter((r) => String(r.draft || '').trim()).length;

  const card = (r) => {
    const e = emails[r.index] || {};
    const cls = r.confidence === 'منخفضة' ? ' low' : '';
    return '<article class="mail' + cls + (r.urgent ? ' urgent' : '') + '">' +
      '<div class="mail-head">' +
        '<h4>' + esc(e.subject) + '</h4>' +
        (r.urgent ? '<span class="pill urgent-pill">عاجلة</span>' : '') +
        '<span class="pill conf-' + (r.confidence === 'منخفضة' ? 'low' : r.confidence === 'متوسطة' ? 'mid' : 'high') + '">' + esc(r.confidence) + '</span>' +
      '</div>' +
      '<p class="from">' + esc(e.from) + '</p>' +
      (r.reason ? '<p class="why">' + esc(r.reason) + '</p>' : '') +
      (String(r.draft || '').trim()
        ? '<div class="draft"><span class="draft-tag">مسودة رد</span><p>' + esc(r.draft) + '</p></div>'
        : (withDrafts ? '<p class="nodraft">بلا مسودة — تُقرأ بعين إنسان</p>' : '')) +
      '</article>';
  };

  const sections = keys.filter((k) => byCat[k]).map((k) =>
    '<section class="cat"><h3>' + esc(k) + ' <span class="count">' + num(byCat[k].length) + '</span></h3>' +
    byCat[k].map(card).join('') + '</section>').join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>فرز بريد الموارد البشرية</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--ink:#22160F;--ink-2:#3A2A1E;--soft:#8A7868;--line:#E6DDD3;
      --bg:#FBF8F4;--card:#FFFFFF;--saffron:#F5A524;--cardamom:#7DB46C;--alert:#C75B39}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'IBM Plex Sans Arabic',system-ui,sans-serif;background:var(--bg);color:var(--ink);
     line-height:1.65;padding:40px 16px 80px}
.wrap{max-width:900px;margin:0 auto}
header{border-bottom:3px solid var(--ink);padding-bottom:22px;margin-bottom:30px}
h1{font-size:clamp(26px,4vw,40px);font-weight:700;letter-spacing:-.5px}
.sub{color:var(--soft);margin-top:6px;font-size:15px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:12px;margin:26px 0 38px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.stat b{display:block;font-size:30px;font-weight:700;line-height:1.1}
.stat span{font-size:13px;color:var(--soft)}
.stat.s-urgent b{color:var(--alert)}
.stat.s-draft b{color:var(--cardamom)}
.cat{margin-bottom:34px}
.cat h3{font-size:21px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:10px}
.count{background:var(--saffron);color:var(--ink);font-size:13px;font-weight:700;
       min-width:26px;height:26px;border-radius:13px;display:grid;place-items:center;padding:0 8px}
.mail{background:var(--card);border:1px solid var(--line);border-inline-start:4px solid var(--line);
      border-radius:12px;padding:16px 18px;margin-bottom:11px}
.mail.low{border-inline-start-color:var(--saffron)}
.mail.urgent{border-inline-start-color:var(--alert)}
.mail-head{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
.mail h4{font-size:17px;font-weight:600;flex:1;min-width:200px}
.pill{font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:20px;white-space:nowrap}
.urgent-pill{background:var(--alert);color:#fff}
.conf-high{background:#EFEAE4;color:var(--soft)}
.conf-mid{background:#FBEED6;color:#8A6410}
.conf-low{background:var(--saffron);color:var(--ink)}
.from{font-size:13px;color:var(--soft);margin-top:3px;direction:ltr;text-align:right}
.why{font-size:14px;color:var(--ink-2);margin-top:8px}
.draft{margin-top:12px;background:#F6FAF4;border:1px solid #DCEBD6;border-radius:9px;padding:12px 14px}
.draft-tag{font-size:11.5px;font-weight:700;color:var(--cardamom);display:block;margin-bottom:5px}
.draft p{font-size:14.5px;color:var(--ink-2)}
.nodraft{margin-top:11px;font-size:13.5px;color:var(--soft);font-style:italic}
footer{margin-top:44px;padding-top:22px;border-top:1px solid var(--line);
       font-size:13.5px;color:var(--soft);text-align:center}
footer b{color:var(--ink)}
@media(prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#1A1109;--card:#241A12;--line:#3A2C20;--ink:#F5EFE8;--ink-2:#D8CCC0;--soft:#9A8878}
  :root:not([data-theme="light"]) .draft{background:#1D2618;border-color:#33442C}
  :root:not([data-theme="light"]) .conf-high{background:#332920;color:var(--soft)}
  :root:not([data-theme="light"]) .conf-mid{background:#3D3018;color:#E0B860}}
</style>
<div class="wrap">
<header>
  <h1>فرز بريد الموارد البشرية</h1>
  <p class="sub">${num(results.length)} رسالة · ${esc(engineLabel)} · ${num(String(secs).replace('.', '٫'))} ثانية</p>
</header>

<div class="stats">
  <div class="stat"><b>${num(results.length)}</b><span>رسالة</span></div>
  <div class="stat s-urgent"><b>${num(urgent)}</b><span>عاجلة اليوم</span></div>
  <div class="stat"><b>${num(low)}</b><span>تحتاج مراجعتك</span></div>
  ${withDrafts ? '<div class="stat s-draft"><b>' + num(drafted) + '</b><span>مسودة جاهزة</span></div>' : ''}
</div>

${sections}

<footer>
  <b>راجع قبل الإرسال.</b> أنت من يرسل، لا البرنامج.<br>
  الشكاوى والمواضيع الحساسة بلا مسودات — عمدًا.
</footer>
</div>
</html>`;
}
