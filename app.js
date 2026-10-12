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

const SAMPLE_BK = `第一章 清晨
清晨，太阳刚刚升起，小村庄安静极了。一个孩子推开房子的门，带着他的狗和猫去河边散步。河水很清，几只鸟停在树上唱歌，水里的鱼慢慢游动。他最好的朋友已经在桥上等他，手里端着两杯热茶。他们一边喝茶，一边看远处高高的山。风轻轻吹过，花摇摇晃晃，像在下雪一样。孩子心里非常快乐，他说：我爱这样的早晨，爱这里的每一棵树、每一朵花，也爱陪我长大的母亲和父亲。

第二章 夜晚
夜晚来临，月亮和星星挂上天空，他们回到房子里一起读书。朋友说明天要去城市，孩子有点难过，但想到风雨之后总会有晴天，又笑着睡着了。`;

const state = {
  wb: null,
  wbName: '',
  bk: null,
  bkName: '',
  chapters: [],
  chapterIndex: 0,
  res: null,
  dict: null,
  entries: [],
  skipped: [],
  filtered: [],
  ambiguous: [],
  excel: null,
};

function opts() {
  return {
    mode: document.querySelector('input[name="mode"]:checked').value,
    notesMode: $('notesMode').value,
    minLen: +$('minLen').value,
    density: +$('density').value,
    strict: $('strictMode').checked,
  };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function chunkText(text, maxChars = 60000) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const paragraphBreak = text.lastIndexOf('\n', end);
      if (paragraphBreak > start + maxChars * 0.6) end = paragraphBreak + 1;
    }
    chunks.push(text.slice(start, end).trim());
    start = end;
  }
  return chunks.length ? chunks : [''];
}

function splitChapters(text) {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const headingRe = /^(?:(?:第[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]{1,12}[章回节卷部篇])|(?:序章|楔子|前言|序言|后记|尾声|番外(?:篇|章)?)|(?:chapter\s+[0-9ivxlcdm]+))(?:[\s　:：.、-]+.*)?$/i;
  const headings = [];

  lines.forEach((line, index) => {
    const title = line.trim();
    if (title && title.length <= 80 && headingRe.test(title)) headings.push({ index, title });
  });

  if (headings.length) {
    const chapters = [];
    const preface = lines.slice(0, headings[0].index).join('\n').trim();
    if (preface) chapters.push({ title: '开篇', text: preface });
    headings.forEach((heading, index) => {
      const end = index + 1 < headings.length ? headings[index + 1].index : lines.length;
      chapters.push({ title: heading.title, text: lines.slice(heading.index + 1, end).join('\n').trim() });
    });
    return chapters.flatMap((chapter) => {
      const parts = chunkText(chapter.text);
      return parts.map((part, index) => ({
        title: parts.length > 1 ? `${chapter.title}（${index + 1}）` : chapter.title,
        text: part,
      }));
    });
  }

  const parts = chunkText(normalized);
  return parts.map((part, index) => ({
    title: parts.length > 1 ? `第 ${index + 1} 部分` : '全文',
    text: part,
  }));
}

function prepareBook() {
  state.chapters = splitChapters(state.bk || '');
  state.chapterIndex = 0;
  state.res = null;
  renderChapterNav();
}

function currentChapter() {
  return state.chapters[state.chapterIndex] || { title: '全文', text: state.bk || '' };
}

function renderChapterNav() {
  const nav = $('chapterNav');
  nav.hidden = state.chapters.length <= 1;
  $('chapterSelect').innerHTML = state.chapters.map((chapter, index) =>
    `<option value="${index}">${index + 1}. ${escapeHtml(chapter.title)}</option>`
  ).join('');
  $('chapterSelect').value = String(state.chapterIndex);
  $('prevChapter').disabled = state.chapterIndex <= 0;
  $('nextChapter').disabled = state.chapterIndex >= state.chapters.length - 1;
  $('chapterFooter').hidden = !state.res;
  $('prevChapterBottom').disabled = state.chapterIndex <= 0;
  $('nextChapterBottom').disabled = state.chapterIndex >= state.chapters.length - 1;
}

function directoryHtml(chapters, selectedIndex) {
  return chapters.map((chapter, index) =>
    `<button type="button" data-chapter="${index}" aria-current="${index === selectedIndex}">${index + 1}. ${escapeHtml(chapter.title)}</button>`
  ).join('');
}

function openDirectory() {
  $('directoryList').innerHTML = directoryHtml(state.chapters, state.chapterIndex);
  $('chapterDirectory').showModal();
  $('directoryList').querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
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
  if (/\.(xlsx|xls)$/.test(name)) throw new Error('Excel 请在“目标语词书”区域导入；中文书请使用 TXT、DOCX 或 PDF');
  if (name.endsWith('.docx')) return loadDocx(file);
  if (name.endsWith('.doc')) throw new Error('暂不支持旧版 .doc，请在 Word 中另存为 .docx 后再上传');
  if (name.endsWith('.pdf')) return loadPdf(file);
  return loadTxt(file, enc);
}

async function loadExcelWorkbook(file) {
  if (!window.XLSX) throw new Error('Excel 解析组件未加载，请刷新后重试');
  try {
    const buffer = await file.arrayBuffer();
    const signature = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    if (!(signature[0] === 0x50 && signature[1] === 0x4b) &&
        !(signature[0] === 0xd0 && signature[1] === 0xcf)) throw new Error('不是 Excel 文件');
    const workbook = XLSX.read(buffer, { type: 'array', dense: true });
    if (!workbook.SheetNames.length) throw new Error('没有工作表');
    return workbook;
  } catch (err) {
    throw new Error('无法读取 Excel，请确认文件有效且未加密，或重新另存为 .xlsx');
  }
}

function selectExcelSheet() {
  const excel = state.excel;
  const sheet = excel.workbook.Sheets[$('excelSheet').value];
  excel.rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '', blankrows: false });
  excel.columns = suggestExcelColumns(excel.rows);
  const width = excel.rows.reduce((max, row) => Math.max(max, row.length), 0);
  const options = Array.from({ length: width }, (_, column) => {
    const letter = XLSX.utils.encode_col(column);
    const label = excel.columns.header[column] || excelCellText(excel.rows[0]?.[column]).slice(0, 30);
    return `<option value="${column}">${letter} 列${label ? ' · ' + escapeHtml(label) : ''}</option>`;
  }).join('');
  $('excelTarget').innerHTML = options;
  $('excelDefinition').innerHTML = '<option value="-1">请选择中文释义列</option>' + options;
  $('excelTarget').value = String(excel.columns.target);
  $('excelDefinition').value = String(excel.columns.definition);
}

function selectedExcelText() {
  const excel = state.excel;
  const result = excelRowsToWordbook(excel.rows, {
    target: Number($('excelTarget').value),
    definition: Number($('excelDefinition').value),
    startRow: excel.columns.startRow,
  });
  if (!parseWordbook(result.text, { strict: false }).entries.length) {
    throw new Error('所选列无法识别为词条，请检查单词列和中文释义列');
  }
  const headerNote = excel.columns.startRow ? '已跳过表头及前面的说明行。' : '未识别到表头，请核对列选择。';
  $('excelSummary').textContent = `当前表读取 ${result.count} 行，跳过 ${result.skipped} 行空白或无中文释义的内容；${headerNote}`;
  return result.text;
}

function updateExcelWordbook() {
  if (!state.excel) return;
  try {
    state.wb = selectedExcelText();
    state.wbName = state.excel.name;
    $('wbStatus').textContent = `已加载：${state.wbName}`;
    $('wbStatus').classList.remove('err');
    $('wbZone').classList.add('ok');
    generate();
    window.readerMemory?.changed('wordbook');
  } catch (err) {
    state.wb = null;
    state.res = null;
    $('wbStatus').textContent = `解析失败：${err.message}`;
    $('wbStatus').classList.add('err');
    $('wbZone').classList.remove('ok');
    $('excelSummary').textContent = '请调整上面的工作表或列选择。';
    $('exportBtn').disabled = $('exportHtmlBtn').disabled = true;
    $('page').innerHTML = '<div class="empty"><p>Excel 词书尚未就绪，请检查工作表和列选择。</p></div>';
    $('vocab').innerHTML = '';
    $('cleanReport').hidden = true;
    $('chapterFooter').hidden = true;
    $('statsText').textContent = '等待有效的 Excel 词书…';
  }
}

$('excelSheet').addEventListener('change', () => { selectExcelSheet(); updateExcelWordbook(); });
['excelTarget', 'excelDefinition'].forEach((id) => $(id).addEventListener('change', updateExcelWordbook));

function renderRep(seg, mode) {
  const target = seg.target == null ? seg.en : seg.target;
  const attr = `data-term="${escapeHtml(target)}"`;
  if (mode === 'en') return `<span class="w" ${attr} dir="auto" title="${escapeHtml(seg.zh)}">${escapeHtml(target)}</span>`;
  if (mode === 'zhen') return `<span class="w zh" ${attr}>${escapeHtml(seg.zh)}<i>（<b class="term" dir="auto">${escapeHtml(target)}</b>）</i></span>`;
  return `<span class="w" ${attr}><b class="term" dir="auto">${escapeHtml(target)}</b><i>（${escapeHtml(seg.zh)}）</i></span>`;
}

function generate() {
  if (!state.wb || !state.bk) return;
  const o = opts();
  const { dict, entries, skipped, filtered, ambiguous, dominantScript } = parseWordbook(state.wb, { strict: o.strict });
  state.dict = dict;
  state.entries = entries;
  state.skipped = skipped;
  state.filtered = filtered;
  state.ambiguous = ambiguous;
  if (!state.chapters.length) prepareBook();

  const chapter = currentChapter();
  const res = transform(chapter.text, dict, { minLen: o.minLen, density: o.density });
  state.res = res;

  const scriptNames = { latin: '拉丁字母', japanese: '日语', korean: '韩语', cyrillic: '西里尔字母', rtl: '阿拉伯/希伯来文字', han: '汉字', mixed: '混合文字', other: '其他文字' };
  const noiseCount = skipped.length + filtered.length;
  let cleanStat = `${entries.length} 条 · ${dict.size} 个可用中文词条`;
  if (o.strict) cleanStat += ` · 识别 ${scriptNames[dominantScript] || dominantScript} · 过滤 ${noiseCount} 项 · 排除 ${ambiguous.length} 个歧义词`;
  else if (skipped.length) cleanStat += ` · 忽略 ${skipped.length} 行`;
  $('wbStatus').textContent = `已加载：${state.wbName}（${cleanStat}）`;
  renderCleanReport(skipped, filtered, ambiguous);
  $('statsText').textContent = `章节 ${state.chapterIndex + 1}/${state.chapters.length} · 本章命中 ${res.counts.size} 个词 · 替换 ${res.stats.replaced} 处`;

  renderPage(o.mode, o.notesMode);
  renderVocab(res.counts, dict);
  renderChapterNav();
  $('exportBtn').disabled = false;
  $('exportHtmlBtn').disabled = false;
}

function renderSegments(res, mode, interactive = false) {
  let offset = 0;
  return res.out.map(seg => {
    const start = offset;
    offset += seg.t === 'txt' ? seg.s.length : seg.zh.length;
    const html = seg.t === 'txt' ? escapeHtml(seg.s) : renderRep(seg, mode);
    if (!interactive) return html;
    const audio = seg.t === 'rep' ? `<button type="button" class="speak-btn" data-speak="${escapeHtml(seg.target ?? seg.en)}" aria-label="发音：${escapeHtml(seg.target ?? seg.en)}">发音</button>` : '';
    return `<span data-source-start="${start}" data-source-length="${offset - start}" data-source-text="${seg.t === 'txt'}">${html}${audio}</span>`;
  }).join('');
}

function renderPage(mode, notesMode) {
  const page = $('page');
  page.style.fontSize = $('fontSize').value + 'px';
  page.classList.toggle('notes-tap', notesMode === 'tap');
  page.classList.remove('all-revealed');
  if (!state.res) return;
  page.innerHTML = `<h2 class="chapter-title">${escapeHtml(currentChapter().title)}</h2>${renderSegments(state.res, mode, true)}`;
}

function vocabHtml(counts, dict) {
  const items = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 80);
  return items.length
    ? '<h3>本篇重点词</h3>' + items.map(([zh, n]) =>
        `<span class="chip"><b dir="auto">${escapeHtml(dict.get(zh))}</b>${escapeHtml(zh)} ×${n}</span>`).join('')
    : '';
}

function renderVocab(counts, dict) {
  $('vocab').innerHTML = vocabHtml(counts, dict);
}

function renderCleanReport(skipped, filtered, ambiguous) {
  const report = $('cleanReport');
  const rejected = [
    ...filtered,
    ...skipped.map((line) => ({ line, reason: '无法识别为有效词条' })),
  ];
  report.hidden = !rejected.length && !ambiguous.length;
  if (report.hidden) return;

  const rejectedHtml = rejected.slice(0, 20).map((item) =>
    `<p>过滤：${escapeHtml(item.line)} <small>（${escapeHtml(item.reason)}）</small></p>`
  ).join('');
  const ambiguousHtml = ambiguous.slice(0, 20).map((item) =>
    `<p>歧义：${escapeHtml(item.zh)} → ${item.targets.map(escapeHtml).join(' / ')}</p>`
  ).join('');
  const more = rejected.length + ambiguous.length > 40
    ? `<p>其余 ${rejected.length + ambiguous.length - 40} 项已省略</p>`
    : '';
  $('cleanReportBody').innerHTML = rejectedHtml + ambiguousHtml + more;
}

// File zones: click label or drag & drop to load.
['wb', 'bk'].forEach((kind) => {
  const zone = $(kind + 'Zone');
  const input = $(kind + 'File');
  const enc = $(kind + 'Enc');
  const status = $(kind + 'Status');
  let importVersion = 0;

  async function handle(file) {
    const version = ++importVersion;
    status.textContent = `正在读取：${file.name}…`;
    try {
      if (kind === 'wb' && /\.(xlsx|xls)$/i.test(file.name)) {
        const workbook = await loadExcelWorkbook(file);
        if (version !== importVersion) return;
        state.excel = { workbook, name: file.name };
        $('excelOptions').hidden = false;
        $('wbEnc').hidden = true;
        $('excelSheet').innerHTML = workbook.SheetNames.map((name) =>
          `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        $('excelSheet').value = workbook.SheetNames[0];
        selectExcelSheet();
        updateExcelWordbook();
        return;
      }
      const text = await loadAnyFile(file, enc.value);
      if (version !== importVersion) return;
      if (kind === 'wb') {
        state.wb = text; state.wbName = file.name; state.excel = null;
        $('excelOptions').hidden = true;
        $('wbEnc').hidden = false;
      }
      else {
        state.bk = text;
        state.bkName = file.name;
        prepareBook();
      }
      const chapterText = kind === 'bk' ? ` · ${state.chapters.length} ${state.chapters.length > 1 ? '章/部分' : '篇'}` : '';
      status.textContent = `已加载：${file.name}（${text.length.toLocaleString()} 字${chapterText}）`;
      status.classList.remove('err');
      zone.classList.add('ok');
      generate();
      window.readerMemory?.changed(kind === 'bk' ? 'book' : 'wordbook');
    } catch (err) {
      if (version !== importVersion) return;
      status.textContent = `解析失败：${err && err.message ? err.message : err}`;
      status.classList.add('err');
      zone.classList.remove('ok');
    }
  }

  input.addEventListener('change', () => { if (input.files[0]) return handle(input.files[0]); });
  ['dragover', 'dragenter'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('drag'); }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) handle(f);
  });
});

// Only replacement settings need a new transform; display settings re-render the current chapter.
document.querySelectorAll('input[name="mode"], #notesMode, #strictMode, #minLen, #density, #fontSize').forEach((el) => {
  el.addEventListener('input', () => {
    const anchor = window.readerMemory?.capture();
    $('densityOut').textContent = $('density').value + '%';
    if (state.res) {
      if (el.id === 'strictMode' || el.id === 'minLen' || el.id === 'density') generate();
      else {
        const o = opts();
        renderPage(o.mode, o.notesMode);
      }
    }
    window.readerMemory?.restorePosition(anchor);
    window.readerMemory?.changed('settings', anchor);
  });
});

function goToChapter(index) {
  const next = Math.max(0, Math.min(index, state.chapters.length - 1));
  if (next !== state.chapterIndex) {
    state.chapterIndex = next;
    generate();
  }
  $('reader').scrollIntoView({ block: 'start' });
  window.readerMemory?.changed('progress');
}

$('chapterSelect').addEventListener('change', (e) => goToChapter(+e.target.value));
$('prevChapter').addEventListener('click', () => goToChapter(state.chapterIndex - 1));
$('nextChapter').addEventListener('click', () => goToChapter(state.chapterIndex + 1));
$('prevChapterBottom').addEventListener('click', () => goToChapter(state.chapterIndex - 1));
$('nextChapterBottom').addEventListener('click', () => goToChapter(state.chapterIndex + 1));
$('openDirectory').addEventListener('click', openDirectory);
$('closeDirectory').addEventListener('click', () => $('chapterDirectory').close());
$('directoryList').addEventListener('click', (e) => {
  const button = e.target.closest('[data-chapter]');
  if (!button) return;
  $('chapterDirectory').close();
  goToChapter(+button.dataset.chapter);
});

$('demoBtn').addEventListener('click', () => {
  state.excel = null;
  $('excelOptions').hidden = true;
  $('wbEnc').hidden = false;
  state.wb = SAMPLE_WB; state.wbName = '示例词书';
  state.bk = SAMPLE_BK; state.bkName = '示例中文书';
  prepareBook();
  $('wbZone').classList.add('ok');
  $('bkZone').classList.add('ok');
  $('bkStatus').textContent = `已加载：示例中文书（${SAMPLE_BK.length.toLocaleString()} 字 · ${state.chapters.length} 章）`;
  generate();
  window.readerMemory?.changed('all');
});

async function transformAllChapters(o, onProgress) {
  const { dict } = parseWordbook(state.wb, { strict: o.strict });
  const results = [];
  for (let index = 0; index < state.chapters.length; index++) {
    results.push(transform(state.chapters[index].text, dict, { minLen: o.minLen, density: o.density }));
    if (onProgress) onProgress(index + 1, state.chapters.length);
    if (index % 3 === 2) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { dict, results };
}

async function runExport(button, task) {
  const oldText = button.textContent;
  $('exportBtn').disabled = true;
  $('exportHtmlBtn').disabled = true;
  try {
    await task((done, total) => { button.textContent = `生成中 ${done}/${total}`; });
  } finally {
    button.textContent = oldText;
    $('exportBtn').disabled = false;
    $('exportHtmlBtn').disabled = false;
  }
}

$('exportBtn').addEventListener('click', async () => {
  if (!state.res) return;
  const o = opts();
  await runExport($('exportBtn'), async (progress) => {
    const { results } = await transformAllChapters(o, progress);
    const text = results.map((res, index) => {
      const body = res.out.map((seg) => seg.t === 'txt' ? seg.s : fmtText(seg, o.mode)).join('');
      return state.chapters.length > 1 ? `${state.chapters[index].title}\n\n${body}` : body;
    }).join('\n\n');
    downloadBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), exportBaseName() + '.txt');
  });
});

function exportBaseName() {
  return (state.bkName || '夹读阅读包').replace(/\.[^.]+$/, '') + '-中英混读';
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function buildReaderPackage(results, dict, o) {
  const title = exportBaseName();
  const tapClass = o.notesMode === 'tap' ? ' notes-tap' : '';
  const chapterOptions = state.chapters.map((chapter, index) =>
    `<option value="${index}">${index + 1}. ${escapeHtml(chapter.title)}</option>`
  ).join('');
  const packageChapters = results.map((res, index) => {
    const chapter = state.chapters[index];
    return {
      title: chapter.title,
      html: `<h2 class="chapter-title">${escapeHtml(chapter.title)}</h2>${renderSegments(res, o.mode)}`,
      vocab: vocabHtml(res.counts, dict),
    };
  });
  const chapterData = JSON.stringify(packageChapters)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  const fallbackChapters = results.map((res, index) => {
    const text = res.out.map((seg) => seg.t === 'txt' ? seg.s : fmtText(seg, o.mode)).join('');
    return `<section class="fallback-chapter"><h2>${escapeHtml(state.chapters[index].title)}</h2>${escapeHtml(text)}</section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{--paper:#f3ecdc;--card:#fffdf7;--ink:#2c2925;--ink2:#756d63;--line:#d8cdb9;--accent:#9d3d28;--accent-deep:#762b1b}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#eee3cd,#f8f3e8 48%,#eadfc9);color:var(--ink);font-family:Georgia,"Noto Serif SC","Songti SC",serif}
main{max-width:900px;margin:0 auto;padding:22px 18px 64px}.bar{position:sticky;top:0;z-index:2;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:10px;padding:12px 14px;margin-bottom:14px;background:rgba(255,253,247,.94);border:1px solid var(--line);border-radius:10px;backdrop-filter:blur(8px);font-family:"Noto Sans SC",sans-serif}
.bar strong{color:var(--accent-deep)}.chapter-nav{display:flex;align-items:center;gap:7px;flex:1;justify-content:center}.chapter-nav select{min-width:160px;max-width:310px;padding:6px;border:1px solid var(--line);border-radius:7px;background:var(--card);color:var(--ink)}button{padding:7px 12px;border:1px solid var(--line);border-radius:999px;background:var(--card);color:var(--ink);font:inherit;cursor:pointer}button:disabled{opacity:.4;cursor:default}.page{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:40px 46px;box-shadow:0 12px 30px rgba(96,72,40,.1);font-size:${$('fontSize').value}px;line-height:2;letter-spacing:.02em;text-align:justify;white-space:pre-wrap;word-break:break-all}.chapter-title{margin:0 0 26px;font-size:1.45em;line-height:1.4;text-align:center;letter-spacing:.08em}.fallback-chapter{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:25px 20px;margin-bottom:14px;white-space:pre-wrap;line-height:1.9}.fallback-chapter h2{text-align:center}
.w{color:var(--accent-deep);font-weight:700;font-family:Georgia,"Noto Serif","Yu Mincho","Hiragino Mincho ProN","Apple SD Gothic Neo","Noto Naskh Arabic","Times New Roman",serif}.w .term{font-weight:inherit}.w i{font-style:normal;font-weight:400;color:var(--ink2);font-size:.8em;font-family:inherit}.w.zh{font-family:inherit;font-weight:600}.js .notes-tap .w{cursor:pointer}.js .notes-tap .w i{filter:blur(5px);opacity:.75;transition:filter .18s ease,opacity .18s ease}.js .notes-tap .w.revealed i,.js .notes-tap.all-revealed .w i{filter:none;opacity:1}.notice{padding:10px 14px;background:#fff4d9;border:1px solid #e4c988;border-radius:8px;color:var(--ink2);font-family:"Noto Sans SC",sans-serif;font-size:14px}
.vocab{margin-top:16px;font-family:"Noto Sans SC",sans-serif}.vocab h3{font-size:14px;color:var(--ink2)}.chip{display:inline-flex;gap:5px;background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 11px;margin:0 7px 7px 0;font-size:12.5px;color:var(--ink2)}.chip b{color:var(--accent-deep)}
.chapter-footer{display:flex;gap:10px;margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}.chapter-footer button{flex:1;min-height:44px;color:var(--accent-deep);border-radius:7px}.directory-dialog{width:min(480px,calc(100% - 32px));max-height:80vh;padding:20px;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:10px}.directory-dialog::backdrop{background:rgba(38,32,25,.4)}.directory-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.directory-heading h2{margin:0;font-size:18px}.directory-list{max-height:55vh;overflow-y:auto;margin-top:14px}.directory-list button{display:block;width:100%;text-align:left;margin-bottom:6px;border-radius:6px;line-height:1.5}.directory-list button[aria-current="true"]{background:#f6e2da;color:var(--accent-deep)}
@media(max-width:700px){main{padding:12px 10px 40px}.bar{align-items:stretch;flex-direction:column}.chapter-nav{order:2}.chapter-nav select{min-width:0;flex:1}.page{padding:25px 20px}.tools{display:flex;gap:8px;width:100%}.tools button{flex:1}}
</style>
</head>
<body>
<main>
  <noscript><p class="notice">当前打开方式不支持点击互动，以下按章节直接显示全书混读文本。使用支持 HTML 的浏览器打开可启用章节切换与点击显示。</p>${fallbackChapters}</noscript>
  <div class="bar">
    <strong>${escapeHtml(title)}</strong>
    <span class="chapter-nav"><button id="prevChapter">上一章</button><select id="chapterSelect">${chapterOptions}</select><button id="nextChapter">下一章</button></span>
    <span class="tools"><button id="revealAll">全部显示</button><button id="hideAll">全部隐藏</button></span>
  </div>
  <section class="chapter"><article id="page" class="page${tapClass}"></article><div id="vocab" class="vocab"></div></section>
  <nav class="chapter-footer" aria-label="章末导航">
    <button id="prevChapterBottom" type="button">上一章</button>
    <button id="openDirectory" type="button" aria-haspopup="dialog">目录</button>
    <button id="nextChapterBottom" type="button">下一章</button>
  </nav>
</main>
<dialog id="chapterDirectory" class="directory-dialog" aria-labelledby="directoryTitle">
  <div class="directory-heading"><h2 id="directoryTitle">章节目录</h2><button id="closeDirectory" type="button">关闭</button></div>
  <div id="directoryList" class="directory-list">${directoryHtml(state.chapters, 0)}</div>
</dialog>
<script>
document.documentElement.classList.add('js');
const chapters=${chapterData};
const page=document.getElementById('page');
const vocab=document.getElementById('vocab');
const select=document.getElementById('chapterSelect');
const prev=document.getElementById('prevChapter');
const next=document.getElementById('nextChapter');
const prevBottom=document.getElementById('prevChapterBottom');
const nextBottom=document.getElementById('nextChapterBottom');
const directory=document.getElementById('chapterDirectory');
const directoryList=document.getElementById('directoryList');
const progressKey='jiadu-reader:'+document.title;
let chapterIndex=0;
function showChapter(index,scroll){
  chapterIndex=Math.max(0,Math.min(index,chapters.length-1));
  page.innerHTML=chapters[chapterIndex].html;vocab.innerHTML=chapters[chapterIndex].vocab;
  select.value=String(chapterIndex);prev.disabled=chapterIndex===0;next.disabled=chapterIndex===chapters.length-1;
  prevBottom.disabled=prev.disabled;nextBottom.disabled=next.disabled;
  try{localStorage.setItem(progressKey,String(chapterIndex))}catch(e){}
  if(scroll)window.scrollTo(0,0);
}
select.addEventListener('change',()=>showChapter(+select.value,true));
prev.addEventListener('click',()=>showChapter(chapterIndex-1,true));
next.addEventListener('click',()=>showChapter(chapterIndex+1,true));
prevBottom.addEventListener('click',()=>showChapter(chapterIndex-1,true));
nextBottom.addEventListener('click',()=>showChapter(chapterIndex+1,true));
document.getElementById('openDirectory').addEventListener('click',()=>{
  directoryList.querySelectorAll('[data-chapter]').forEach(button=>button.setAttribute('aria-current',String(+button.dataset.chapter===chapterIndex)));
  directory.showModal();directoryList.querySelector('[aria-current="true"]')?.scrollIntoView({block:'nearest'});
});
document.getElementById('closeDirectory').addEventListener('click',()=>directory.close());
directoryList.addEventListener('click',e=>{const button=e.target.closest('[data-chapter]');if(!button)return;directory.close();showChapter(+button.dataset.chapter,true)});
page.addEventListener('click',e=>{if(!page.classList.contains('notes-tap'))return;const w=e.target.closest('.w');if(w)w.classList.toggle('revealed')});
document.getElementById('revealAll').addEventListener('click',()=>page.classList.add('all-revealed'));
document.getElementById('hideAll').addEventListener('click',()=>{page.classList.remove('all-revealed');page.querySelectorAll('.w').forEach(w=>w.classList.remove('revealed'))});
let saved=0;try{saved=+localStorage.getItem(progressKey)||0}catch(e){}showChapter(saved,false);
<\/script>
</body>
</html>`;
}

$('exportHtmlBtn').addEventListener('click', async () => {
  if (!state.res) return;
  const o = opts();
  await runExport($('exportHtmlBtn'), async (progress) => {
    const { dict, results } = await transformAllChapters(o, progress);
    downloadBlob(
      new Blob([buildReaderPackage(results, dict, o)], { type: 'text/html;charset=utf-8' }),
      exportBaseName() + '.html'
    );
  });
});

// 点击单词切换注释显示（自测模式）
$('page').addEventListener('click', (e) => {
  const audio = e.target.closest('[data-speak]');
  if (audio) { window.readerSpeech?.speak(audio.dataset.speak); return; }
  const page = $('page');
  const w = e.target.closest('.w');
  if (w && page.classList.contains('notes-tap')) w.classList.toggle('revealed');
  if (w && $('speakOnWord').checked) window.readerSpeech?.speak(w.dataset.term);
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
