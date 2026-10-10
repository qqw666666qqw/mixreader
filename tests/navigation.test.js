const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');
const excel = require('../excel.js');
const XLSX = require('../vendor/xlsx.full.min.js');

function element() {
  const classes = new Set();
  return {
    value: '', checked: false, disabled: false, hidden: false,
    innerHTML: '', textContent: '', style: {}, handlers: {},
    open: false, scrolls: 0,
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
      contains: (value) => classes.has(value),
      toggle(value, force) {
        const enabled = force === undefined ? !classes.has(value) : force;
        if (enabled) classes.add(value);
        else classes.delete(value);
      },
    },
    addEventListener(type, handler) { this.handlers[type] = handler; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    scrollIntoView() { this.scrolls++; },
    showModal() { this.open = true; },
    close() { this.open = false; },
  };
}

function mockDocument() {
  const elements = new Map();
  return {
    elements,
    documentElement: element(),
    title: 'Navigation test',
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    querySelector() { return { value: 'enzh' }; },
    querySelectorAll() { return []; },
  };
}

async function test() {
  const document = mockDocument();
  const get = (id) => document.getElementById(id);
  get('strictMode').checked = true;
  get('notesMode').value = 'tap';
  get('minLen').value = '2';
  get('density').value = '100';
  get('fontSize').value = '20';
  const context = vm.createContext({
    ...core, ...excel, document, window: {}, setTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8'), context);

  const utf8File = {
    name: 'wordbook.txt',
    arrayBuffer: async () => Uint8Array.from(Buffer.from('bonjour 你好')).buffer,
  };
  context.TextDecoder = TextDecoder;
  context.testFile = utf8File;
  assert.equal(await vm.runInContext("loadAnyFile(testFile, 'utf-8')", context), 'bonjour 你好');
  context.testFile = {
    name: 'book.docx', arrayBuffer: utf8File.arrayBuffer,
  };
  context.window.mammoth = context.mammoth = {
    extractRawText: async () => ({ value: '中文书正文' }),
  };
  assert.equal(await vm.runInContext("loadAnyFile(testFile, 'utf-8')", context), '中文书正文');
  context.testFile = { name: 'book.pdf', arrayBuffer: utf8File.arrayBuffer };
  context.window.pdfjsLib = context.pdfjsLib = {
    getDocument: () => ({ promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({ getTextContent: async () => ({
        items: [{ str: '第一章', transform: [1, 0, 0, 1, 0, 20] }, { str: '中文正文', transform: [1, 0, 0, 1, 0, 10] }],
      }) }),
      destroy: async () => {},
    }) }),
  };
  assert.equal(await vm.runInContext("loadAnyFile(testFile, 'utf-8')", context), '第一章\n中文正文\n');

  const rows = [
    ['词书说明'],
    ['序号', '英文单词', '音标', '中文释义', '例句'],
    [1, 'friend', '/frend/', '朋友', 'a friend'],
    [2, 'ice cream', '', '冰淇淋', 'unrelated 中文例句'],
    [3, 'lonely', '', '', '孤独的例句，不是释义'],
    [4, 'happy', '', '快乐的；高兴的', ''],
  ];
  assert.deepEqual(excel.suggestExcelColumns(rows), {
    target: 1, definition: 3, startRow: 2, header: rows[1].map(String),
  });
  const converted = excel.excelRowsToWordbook(rows, excel.suggestExcelColumns(rows));
  assert.equal(converted.count, 3);
  assert.equal(converted.skipped, 1);
  assert.equal(core.parseWordbook(converted.text).dict.get('冰淇淋'), 'ice cream');
  assert.ok(!converted.text.includes('例句'));
  assert.deepEqual(excel.suggestExcelColumns([['你好', 'bonjour'], ['苹果', 'apple']]), {
    target: 1, definition: 0, startRow: 0, header: [],
  });
  assert.equal(excel.excelRowsToWordbook([['ice\ncream', '冰淇淋\n甜点']], {
    target: 0, definition: 1,
  }).text, 'ice cream\t冰淇淋 甜点');
  assert.throws(() => excel.excelRowsToWordbook([['apple']], { target: 0, definition: -1 }), /只有英文/);
  assert.throws(() => excel.excelRowsToWordbook([['apple', 'fruit']], { target: 0, definition: 1 }), /没有有效/);
  assert.throws(() => excel.excelRowsToWordbook([], { target: 0, definition: 1 }), /没有有效/);
  assert.throws(() => excel.excelRowsToWordbook(rows, { target: 1, definition: 1 }), /不同/);

  context.window.XLSX = context.XLSX = XLSX;
  for (const bookType of ['xlsx', 'biff8']) {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '词书');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['中文释义', '单词'], ['河流', 'river'], ['月亮', 'moon'],
    ]), '第二表');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType });
    get('wbFile').files = [{
      name: bookType === 'xlsx' ? 'wordbook.xlsx' : 'wordbook.xls',
      arrayBuffer: async () => Uint8Array.from(bytes).buffer,
    }];
    await get('wbFile').handlers.change();
    assert.equal(get('excelOptions').hidden, false);
    assert.equal(get('wbEnc').hidden, true);
    assert.equal(get('excelTarget').value, '1');
    assert.equal(get('excelDefinition').value, '3');
    assert.match(get('excelSummary').textContent, /读取 3 行/);
    assert.equal(vm.runInContext('parseWordbook(state.wb).dict.get("朋友")', context), 'friend');
    get('excelSheet').value = '第二表';
    get('excelSheet').handlers.change();
    assert.equal(vm.runInContext('parseWordbook(state.wb).dict.get("河流")', context), 'river');
    assert.equal(vm.runInContext('parseWordbook(state.wb).dict.has("朋友")', context), false);
    get('excelTarget').value = get('excelDefinition').value;
    get('excelTarget').handlers.change();
    assert.match(get('wbStatus').textContent, /请选择不同/);
    assert.equal(vm.runInContext('state.wb', context), null);
    assert.equal(get('exportBtn').disabled, true);
  }
  get('wbFile').files = [utf8File];
  await get('wbFile').handlers.change();
  assert.equal(get('excelOptions').hidden, true);
  assert.equal(get('wbEnc').hidden, false);
  context.testFile = { name: 'book.xlsx' };
  await assert.rejects(vm.runInContext("loadAnyFile(testFile, 'utf-8')", context), /目标语词书/);
  context.testFile = utf8File;
  await assert.rejects(vm.runInContext('loadExcelWorkbook(testFile)', context), /文件有效且未加密/);
  context.window.XLSX = null;
  await assert.rejects(vm.runInContext('loadExcelWorkbook(testFile)', context), /组件未加载/);
  context.window.XLSX = XLSX;

  get('demoBtn').handlers.click();
  assert.equal(get('chapterFooter').hidden, false);
  assert.equal(get('prevChapterBottom').disabled, true);
  assert.equal(get('nextChapterBottom').disabled, false);

  get('nextChapterBottom').handlers.click();
  assert.match(get('page').innerHTML, /第二章 夜晚/);
  assert.equal(get('prevChapterBottom').disabled, false);
  assert.equal(get('nextChapterBottom').disabled, true);
  assert.equal(get('reader').scrolls, 1);

  get('openDirectory').handlers.click();
  assert.equal(get('chapterDirectory').open, true);
  assert.match(get('directoryList').innerHTML, /data-chapter="1" aria-current="true"/);
  get('directoryList').handlers.click({
    target: { closest: () => ({ dataset: { chapter: '0' } }) },
  });
  assert.equal(get('chapterDirectory').open, false);
  assert.match(get('page').innerHTML, /第一章 清晨/);
  assert.equal(get('reader').scrolls, 2);
  vm.runInContext('goToChapter(0)', context);
  assert.equal(get('reader').scrolls, 3);

  const html = await vm.runInContext(`(async () => {
    const o = opts();
    const { results, dict } = await transformAllChapters(o);
    return buildReaderPackage(results, dict, o);
  })()`, context);
  assert.ok(html.indexOf('id="vocab"') < html.indexOf('aria-label="章末导航"'));
  assert.match(html, /id="prevChapterBottom"/);
  assert.match(html, /id="nextChapterBottom"/);

  const exportedDocument = mockDocument();
  const exportedGet = (id) => exportedDocument.getElementById(id);
  const exportedContext = vm.createContext({
    document: exportedDocument,
    localStorage: { getItem: () => '0', setItem() {} },
    window: { scrollTo() {} },
  });
  vm.runInContext(html.match(/<script>([\s\S]*)<\/script>/)[1], exportedContext);
  assert.equal(exportedGet('prevChapterBottom').disabled, true);
  exportedGet('nextChapterBottom').handlers.click();
  assert.match(exportedGet('page').innerHTML, /第二章 夜晚/);
  assert.equal(exportedGet('nextChapterBottom').disabled, true);
  exportedGet('openDirectory').handlers.click();
  assert.equal(exportedGet('chapterDirectory').open, true);
  exportedGet('directoryList').handlers.click({
    target: { closest: () => ({ dataset: { chapter: '0' } }) },
  });
  assert.match(exportedGet('page').innerHTML, /第一章 清晨/);
  assert.equal(exportedGet('chapterDirectory').open, false);
  console.log('Real XLSX/XLS import and column selection, TXT import, DOCX/PDF integration mocks, chapter footer and exported reader tests passed.');
}

test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
