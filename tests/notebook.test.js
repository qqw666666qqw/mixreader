const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeVocabulary, vocabularyExcelRows, vocabularyPosLabel } = require('../vocabulary.js');

async function test() {
  const elements = new Map(), words = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: true, open: false, textContent: '', innerHTML: '', disabled: false, handlers: {},
      options: [], addEventListener(type, callback) { this.handlers[type] = callback; },
      setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; },
      dispatchEvent(event) { this.handlers[event.type]?.(event); },
    });
    return elements.get(id);
  };
  $('speechLang').value = 'en-US'; $('speechLang').options = [{ value: 'en-US' }];
  const speech = [], progress = [], flags = [], scrolls = [];
  let restoreAnchor, failSave = false;
  const anchor = { view: 'reader', offset: 42, y: 70 };
  const store = {
    all: async () => [...words.values()], get: async (name, id) => words.get(id),
    collectWord: async record => {
      if (failSave) throw new Error('quota');
      const added = !words.has(record.id); words.set(record.id, record); return { added };
    }, deleteWord: async id => words.delete(id),
  };
  const memory = {
    store, ready: Promise.resolve(), capture: () => anchor,
    changed: (...args) => progress.push(args),
    setNotebookOpen: value => flags.push(value), restorePosition: value => { restoreAnchor = value; },
  };
  const window = { readerMemory: memory, readerSpeech: { stop() {}, speak: text => speech.push(text) },
    scrollY: 100, scrollTo: (...args) => scrolls.push(args), handlers: {},
    addEventListener(type, callback) { this.handlers[type] = callback; }, confirm: () => true,
  };
  const context = vm.createContext({ window, location: { hash: '' },
    document: { body: { classList: { toggle() {} } }, querySelectorAll: () => [] }, $, normalizeVocabulary,
    vocabularyExcelRows, vocabularyPosLabel, escapeHtml: text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    state: { wordDetails: new Map([[JSON.stringify(['快乐', 'happy']), { meaning: '快乐的；高兴的', pos: 'adj.' }]]) },
    setTimeout: () => 1, clearTimeout() {}, Event: class { constructor(type) { this.type = type; } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../notebook.js'), 'utf8'), context);
  await memory.ready; await Promise.resolve();
  await window.readerVocabulary.open('happy', '快乐');
  assert.equal($('vocabularyDialog').open, true);
  assert.equal($('collectMeaning').textContent, '快乐的；高兴的');
  assert.ok($('collectPos').innerHTML.includes('形容词'));
  await $('collectVocabulary').handlers.click();
  assert.equal(words.size, 1);
  await window.readerVocabulary.open('happy', '快乐');
  assert.equal($('collectVocabulary').disabled, true);
  assert.equal($('collectVocabulary').textContent, '已加入生词本');
  await window.readerVocabulary.open('walk', '散步');
  failSave = true;
  await $('collectVocabulary').handlers.click();
  assert.match($('collectStatus').textContent, /收藏失败/);
  assert.equal($('collectVocabulary').disabled, false);
  failSave = false;
  await $('collectVocabulary').handlers.click();
  assert.equal(words.size, 2);

  context.location.hash = '#vocabulary'; window.handlers.hashchange();
  assert.equal(flags.at(-1), true);
  assert.equal($('notebookView').hidden, false);
  assert.equal(progress.at(-1)[1], anchor);
  context.location.hash = '#reading'; window.handlers.hashchange();
  assert.equal(flags.at(-1), false);
  assert.equal(restoreAnchor, anchor);
  const happy = [...words.values()].find(item => item.word === 'happy');
  await $('notebookList').handlers.click({ target: { closest: selector => selector === '[data-vocabulary-speak]' ? { dataset: { vocabularySpeak: happy.id } } : null } });
  assert.equal(speech.at(-1), 'happy');
  await $('notebookList').handlers.click({ target: { closest: selector => selector === '[data-remove-word]' ? { dataset: { removeWord: happy.id } } : null } });
  assert.equal(words.size, 1);
  $('notebookSearch').value = '没有'; $('notebookSearch').handlers.input();
  assert.equal($('notebookNoResults').hidden, false);
  console.log('Notebook collection, definition/POS, duplicate/save failure, navigation anchor, speech, remove and search tests passed.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
