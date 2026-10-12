const assert = require('node:assert/strict');
const { validateReaderBackup, createReaderStore } = require('../storage.js');
const { createReaderSpeech } = require('../speech.js');

async function test() {
  const backup = {
    format: 'jiadu-backup', version: 1,
    books: [{ id: 'book:a', name: '同名书.txt', text: '第一章\n正文' }],
    wordbooks: [{ id: 'wordbook:b', name: '词书.xlsx', text: 'friend 朋友', excel: {
      sheets: [{ name: '表1', rows: [['word', 'meaning'], ['friend', '朋友']] }],
    } }],
    sessions: [{ id: 'book:a', wordbookId: 'wordbook:b', chapter: 0, anchor: { offset: 2, view: 'reader' } }],
    meta: [{ id: 'current', bookId: 'book:a' }],
  };
  assert.equal(validateReaderBackup(backup).books[0].text, '第一章\n正文');
  assert.throws(() => validateReaderBackup({ ...backup, version: 2 }), /受支持/);
  assert.throws(() => validateReaderBackup({ ...backup, books: [{ id: 'book:a', name: 'bad' }] }), /正文/);
  assert.throws(() => validateReaderBackup({ ...backup, books: [...backup.books, ...backup.books] }), /重复/);
  assert.throws(() => validateReaderBackup({ ...backup, wordbooks: [] }), /关联/);
  assert.throws(() => validateReaderBackup({ ...backup, wordbooks: [{ ...backup.wordbooks[0], excel: { sheets: [{ name: 'bad', rows: [[{}]] }] } }] }), /表格/);
  await assert.rejects(createReaderStore(null).ready, /无法保存/);

  global.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
  function control(value = '') {
    return { value, textContent: '', handlers: {}, options: [],
      addEventListener(type, fn) { this.handlers[type] = fn; },
      replaceChildren(option) { this.options = [option]; this.value = option.value; },
      add(option) { this.options.push(option); },
    };
  }
  const controls = { lang: control('en-GB'), rate: control('0.7'), voice: control(), status: control(), stop: control() };
  const spoken = [], calls = [];
  const english = { lang: 'en-GB', voiceURI: 'daniel', name: 'Daniel', localService: true };
  const host = {
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
    speechSynthesis: {
      getVoices: () => [english], addEventListener() {},
      cancel: () => calls.push('cancel'), speak: utterance => spoken.push(utterance),
    },
  };
  const speech = createReaderSpeech(host, controls);
  speech.speak('friend');
  assert.equal(spoken[0].text, 'friend');
  assert.equal(spoken[0].lang, 'en-GB');
  assert.equal(spoken[0].rate, .7);
  assert.equal(spoken[0].voice, english);
  speech.speak('moon');
  assert.equal(calls.length, 2);
  spoken[0].onend();
  assert.match(controls.status.textContent, /moon/);
  spoken[1].onend();
  assert.equal(controls.status.textContent, '发音完成');
  spoken[1].onerror({ error: 'network' });
  assert.match(controls.status.textContent, /发音失败/);
  controls.lang.value = 'ja-JP';
  speech.speak('こんにちは');
  assert.equal(spoken.length, 2);
  assert.match(controls.status.textContent, /没有该语言/);
  controls.stop.handlers.click();
  assert.equal(controls.status.textContent, '已停止发音');
  createReaderSpeech({}, controls).speak('word');
  assert.match(controls.status.textContent, /不支持/);
  console.log('Backup validation, unsupported storage and speech language/rate/cancel/error tests passed.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
