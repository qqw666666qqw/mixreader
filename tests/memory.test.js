const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { validateReaderBackup } = require('../storage.js');

async function test() {
  const records = Object.fromEntries(['books', 'wordbooks', 'sessions', 'meta'].map(name => [name, new Map()]));
  const store = {
    ready: Promise.resolve(), get: async (name, id) => records[name].get(id),
    all: async name => [...records[name].values()],
    write: async data => {
      for (const [name, items] of Object.entries(data)) for (const item of items) records[name].set(item.id, structuredClone(item));
    },
    deleteBook: async id => { records.books.delete(id); records.sessions.delete(id); },
  };
  function element() {
    return {
      value: '', checked: false, hidden: false, textContent: '', innerHTML: '', handlers: {},
      options: [], tagName: 'SELECT', min: '16', max: '30',
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, callback) { this.handlers[type] = callback; },
      getBoundingClientRect: () => ({ top: 2000 }), querySelectorAll: () => [],
      click() {},
    };
  }
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  for (const [id, value] of Object.entries({ notesMode: 'tap', minLen: '2', density: '100', fontSize: '20', wbEnc: 'utf-8', bkEnc: 'utf-8', speechLang: 'en-US', speechRate: '.9', speechEngine: 'online' })) {
    get(id).value = value; get(id).options = [{ value }];
  }
  const state = { bk: null, wb: null, bkName: '', wbName: '', excel: null, res: null, chapterIndex: 0, chapters: [] };
  let backupText;
  const context = vm.createContext({
    state, $: get, createReaderStore: () => store, validateReaderBackup,
    createReaderSpeech: () => ({ refresh() {}, setVoice() {}, stop() {}, voicePreference: () => '' }),
    opts: () => ({ mode: 'enzh' }), escapeHtml: text => text,
    window: { indexedDB: {}, innerHeight: 800, addEventListener() {}, confirm: () => true, scrollTo() {} },
    document: { addEventListener() {}, querySelector: () => ({ checked: false }) },
    navigator: {}, crypto: webcrypto, TextEncoder, setTimeout, clearTimeout, Date,
    requestAnimationFrame: callback => callback(),
    Blob, URL: { revokeObjectURL() {}, createObjectURL(blob) { backupText = blob.text(); return 'blob:backup'; } },
    currentChapter: () => ({ text: state.bk || '' }),
    prepareBook() { state.chapters = [{ title: '第一章' }, { title: '第二章' }]; state.chapterIndex = 0; },
    generate() { state.res = {}; }, renderChapterNav() {},
  });
  vm.runInContext(fs.readFileSync(require.resolve('../memory.js'), 'utf8'), context);
  const memory = context.window.readerMemory;
  await memory.ready;
  state.bk = '第一章\n正文'; state.bkName = 'book.txt';
  state.wb = 'friend 朋友'; state.wbName = 'words.txt';
  state.chapterIndex = 1;
  get('allowNetworkSpeech').checked = true;
  await memory.changed('all');
  assert.equal(records.books.size, 1);
  assert.equal(records.wordbooks.size, 1);
  const firstId = [...records.books.keys()][0];
  assert.equal(records.sessions.get(firstId).chapter, 1);
  assert.equal(records.sessions.get(firstId).settings.speechEngine, 'online');
  assert.equal(records.sessions.get(firstId).settings.allowNetworkSpeech, true);
  await memory.changed('settings', { view: 'reader', offset: 12, y: 70 });
  assert.equal(records.sessions.get(firstId).anchor.offset, 12);
  assert.equal(records.books.size, 1);
  state.bk = '另一份不同正文'; state.bkName = 'book.txt';
  await memory.changed('book');
  assert.equal(records.books.size, 2, 'same filename, different contents must remain separate');
  get('savedBooks').value = firstId;
  await get('openSavedBook').handlers.click();
  assert.equal(state.bk, '第一章\n正文');
  assert.equal(state.chapterIndex, 1);
  assert.equal(state.wb, 'friend 朋友');
  await get('backupLibrary').handlers.click();
  const data = JSON.parse(await backupText);
  validateReaderBackup(data);
  assert.equal(data.books.length, 2);
  assert.equal(get('backupDownload').hidden, false);
  get('backupFile').files = [{ text: async () => JSON.stringify(data) }];
  await get('backupFile').handlers.change();
  assert.match(get('saveStatus').textContent, /备份已恢复/);
  assert.equal(state.bk, '第一章\n正文');
  const originalWrite = store.write;
  store.write = async () => { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; };
  await memory.changed('all');
  assert.match(get('saveStatus').textContent, /空间不足/);
  await memory.changed('progress');
  assert.match(get('saveStatus').textContent, /空间不足/, 'later progress must not hide a failed content save');
  store.write = originalWrite;
  await memory.changed('all');
  assert.match(get('saveStatus').textContent, /已保存/);
  console.log('Library persistence, same-name identity, session restoration, backup/restore and quota failure tests passed.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
