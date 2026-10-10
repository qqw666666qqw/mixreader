const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core.js');

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
    ...core, document, window: {}, setTimeout,
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
  console.log('TXT import, DOCX/PDF integration mocks, chapter footer and exported reader tests passed.');
}

test().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
