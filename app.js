// DOM wiring for the mixed reader prototype.

const $ = (id) => document.getElementById(id);

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

const SAMPLE_WB = `dog n. 狗
cat n. 猫
water n. 水
book n. 书；书籍
read v. 读；阅读
sun n. 太阳
moon n. 月亮
tree n. 树
flower n. 花
house n. 房子；住宅
morning n. 早晨；早上
friend n. 朋友
happy adj. 快乐的；高兴的
walk v. 散步；行走
eat v. 吃
drink v. 喝；饮
tea n. 茶
mountain n. 山；高山
river n. 河；河流
bird n. 鸟
fish n. 鱼
night n. 夜晚；晚上
star n. 星星
wind n. 风
rain n. 雨；雨水
snow n. 雪；雪花
city n. 城市
village n. 村庄；乡村
child n. 孩子；儿童
mother n. 母亲；妈妈
father n. 父亲；爸爸
love v. 爱；热爱`;

const SAMPLE_BK = `清晨，太阳刚刚升起，小村庄安静极了。一个孩子推开房子的门，带着他的狗和猫去河边散步。河水很清，几只鸟停在树上唱歌，水里的鱼慢慢游动。他最好的朋友已经在桥上等他，手里端着两杯热茶。他们一边喝茶，一边看远处高高的山。风轻轻吹过，花摇摇晃晃，像在下雪一样。孩子心里非常快乐，他说：我爱这样的早晨，爱这里的每一棵树、每一朵花，也爱陪我长大的母亲和父亲。夜晚来临，月亮和星星挂上天空，他们回到房子里一起读书。朋友说明天要去城市，孩子有点难过，但想到风雨之后总会有晴天，又笑着睡着了。`;

const state = { wb: null, wbName: '', bk: null, bkName: '', res: null, truncated: false };

function opts() {
  return {
    mode: document.querySelector('input[name="mode"]:checked').value,
    notesMode: $('notesMode').value,
    minLen: +$('minLen').value,
    density: +$('density').value,
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadTxt(file, enc) {
  const buf = await file.arrayBuffer();
  let text;
  try { text = new TextDecoder(enc, { fatal: true }).decode(buf); }
  catch (e) { text = new TextDecoder('utf-8').decode(buf); }
  return text.replace(/^\uFEFF/, '');
}

async function loadDocx(file) {
  if (!window.mammoth) throw new Error('docx 解析组件未加载，请检查网络后刷新');
  const res = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return res.value;
}

async function loadPdf(file) {
  if (!window.pdfjsLib) throw new Error('pdf 解析组件未加载，请检查网络后刷新');
  const CDN = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/';
  const doc = await pdfjsLib.getDocument({
    data: await file.arrayBuffer(),
    // 中文 PDF 常用 CID 字体，需要 CMap 数据才能正确提取文字
    cMapUrl: CDN + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: CDN + 'standard_fonts/',
  }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // pdf.js 的文本项不保证带换行，用 y 坐标变化判断行边界
    let lineY = null, line = '';
    for (const it of tc.items) {
      if (typeof it.str !== 'string') continue;
      const y = it.transform ? it.transform[5] : null;
      if (lineY !== null && y !== null && Math.abs(y - lineY) > 2) { text += line + '\n'; line = ''; }
      if (y !== null) lineY = y;
      line += it.str;
    }
    text += line + '\n';
  }
  await doc.destroy();
  return text;
}

async function loadAnyFile(file, enc) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) return loadDocx(file);
  if (name.endsWith('.doc')) throw new Error('暂不支持旧版 .doc，请在 Word 中另存为 .docx 后再上传');
  if (name.endsWith('.pdf')) return loadPdf(file);
  return loadTxt(file, enc);
}

function renderRep(seg, mode) {
  if (mode === 'en') return `<span class="w" title="${escapeHtml(seg.zh)}">${escapeHtml(seg.en)}</span>`;
  if (mode === 'zhen') return `<span class="w zh">${escapeHtml(seg.zh)}<i>（${escapeHtml(seg.en)}）</i></span>`;
  return `<span class="w">${escapeHtml(seg.en)}<i>（${escapeHtml(seg.zh)}）</i></span>`;
}

function generate() {
  if (!state.wb || !state.bk) return;
  const { dict, entries, skipped } = parseWordbook(state.wb);
  const o = opts();
  const LIMIT = 400000;
  state.truncated = state.bk.length > LIMIT;
  const res = transform(state.bk.slice(0, LIMIT), dict, { minLen: o.minLen, density: o.density });
  state.res = res;

  $('wbStatus').textContent = `已加载：${state.wbName}（${entries.length} 条 · ${dict.size} 个中文词条${skipped.length ? ` · 忽略 ${skipped.length} 行` : ''}）`;

  let stat = `词书 ${entries.length} 条 · 命中 ${res.counts.size} 个词 · 替换 ${res.stats.replaced} 处`;
  if (state.truncated) stat += ' · 预览仅前 40 万字';
  $('statsText').textContent = stat;

  renderPage(o.mode, o.notesMode);
  renderVocab(res.counts, dict);
  $('exportBtn').disabled = false;
}

function renderPage(mode, notesMode) {
  const page = $('page');
  page.style.fontSize = $('fontSize').value + 'px';
  page.classList.toggle('notes-tap', notesMode === 'tap');
  page.classList.remove('all-revealed');
  if (!state.res) return;
  let html = '';
  for (const seg of state.res.out) {
    html += seg.t === 'txt' ? escapeHtml(seg.s) : renderRep(seg, mode);
  }
  page.innerHTML = html;
}

function renderVocab(counts, dict) {
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
  $('vocab').innerHTML = items.length
    ? '<h3>本篇重点词</h3>' + items.map(([zh, n]) =>
        `<span class="chip"><b>${escapeHtml(dict.get(zh))}</b>${escapeHtml(zh)} ×${n}</span>`).join('')
    : '';
}

// File zones: click label or drag & drop to load.
['wb', 'bk'].forEach((kind) => {
  const zone = $(kind + 'Zone');
  const input = $(kind + 'File');
  const enc = $(kind + 'Enc');
  const status = $(kind + 'Status');

  async function handle(file) {
    try {
      const text = await loadAnyFile(file, enc.value);
      if (kind === 'wb') { state.wb = text; state.wbName = file.name; }
      else { state.bk = text; state.bkName = file.name; }
      status.textContent = `已加载：${file.name}（${text.length.toLocaleString()} 字）`;
      status.classList.remove('err');
      zone.classList.add('ok');
      generate();
    } catch (err) {
      status.textContent = `解析失败：${err && err.message ? err.message : err}`;
      status.classList.add('err');
      zone.classList.remove('ok');
    }
  }

  input.addEventListener('change', () => { if (input.files[0]) handle(input.files[0]); });
  ['dragover', 'dragenter'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handle(f);
  });
});

// Option changes re-render (dict unchanged, transform is cheap enough here).
document.querySelectorAll('input[name="mode"], #notesMode, #minLen, #density, #fontSize').forEach((el) => {
  el.addEventListener('input', () => {
    $('densityOut').textContent = $('density').value + '%';
    if (state.res) {
      if (el.id === 'fontSize') { const o = opts(); renderPage(o.mode, o.notesMode); return; }
      generate();
    }
  });
});

$('demoBtn').addEventListener('click', () => {
  state.wb = SAMPLE_WB; state.wbName = '示例词书';
  state.bk = SAMPLE_BK; state.bkName = '示例中文书';
  $('wbZone').classList.add('ok');
  $('bkZone').classList.add('ok');
  generate();
});

$('exportBtn').addEventListener('click', () => {
  if (!state.res) return;
  const mode = opts().mode;
  const text = state.res.out.map((s) => (s.t === 'txt' ? s.s : fmtText(s, mode))).join('');
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = state.bkName.replace(/\.[^.]+$/, '') + '-中英混读.txt';
  a.click();
  URL.revokeObjectURL(a.href);
});

// 点击单词切换注释显示（自测模式）
$('page').addEventListener('click', (e) => {
  const page = $('page');
  if (!page.classList.contains('notes-tap')) return;
  const w = e.target.closest('.w');
  if (w) w.classList.toggle('revealed');
});

// 全部显示 / 全部隐藏
$('revealAll').addEventListener('click', () => {
  const page = $('page');
  page.classList.add('all-revealed');
  page.querySelectorAll('.w').forEach((el) => el.classList.add('revealed'));
});
$('hideAll').addEventListener('click', () => {
  const page = $('page');
  page.classList.remove('all-revealed');
  page.querySelectorAll('.w').forEach((el) => el.classList.remove('revealed'));
});
