const assert = require('node:assert/strict');
const { createReaderSpeech } = require('../speech.js');

global.Option = class { constructor(text, value) { this.text = text; this.value = value; } };
function fixture({ native = false, available = [], rejection, throws = false } = {}) {
  function control(value = '') {
    return {
      value, checked: false, hidden: true, textContent: '', handlers: {}, options: [],
      addEventListener(type, callback) { (this.handlers[type] ||= []).push(callback); },
      dispatchEvent(event) { for (const handler of this.handlers[event.type] || []) handler(event); },
      replaceChildren(option) { this.options = [option]; this.value = option.value; },
      add(option) { this.options.push(option); },
    };
  }
  const controls = Object.fromEntries(['lang', 'rate', 'voice', 'status', 'stop', 'engine', 'network',
    'feedback', 'feedbackText', 'retry', 'dismiss', 'notice'].map(id => [id, control()]));
  controls.lang.value = 'en-US'; controls.rate.value = '.7'; controls.engine.value = 'auto';
  const players = [], utterances = [], timers = new Map();
  let timerId = 0;
  const host = {
    Event: class { constructor(type) { this.type = type; } },
    setTimeout(callback, delay) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    Audio: class {
      constructor() { players.push(this); }
      play() { this.playCalled = true; return rejection ? Promise.reject(rejection) : Promise.resolve(); }
      pause() { this.paused = true; }
      removeAttribute(name) { delete this[name]; }
      load() { this.cleared = true; }
    },
  };
  if (native) {
    host.speechSynthesis = {
      getVoices: () => available,
      cancel() {}, // Intentionally no addEventListener, as in incomplete implementations.
      speak(utterance) { utterances.push(utterance); if (throws) throw new Error('service unavailable'); },
    };
    host.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  }
  const speech = createReaderSpeech(host, controls);
  const change = id => controls[id].dispatchEvent(new host.Event('change'));
  const click = id => controls[id].dispatchEvent(new host.Event('click'));
  const timeout = delay => {
    const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay);
    assert.ok(entry, `expected ${delay}ms timer`);
    timers.delete(entry[0]); entry[1].callback();
  };
  return { host, controls, players, utterances, timers, speech, change, click, timeout };
}

async function test() {
  const unsupported = fixture();
  unsupported.speech.speak('friend');
  assert.equal(unsupported.players.length, 0, 'no third-party request without consent');
  assert.equal(unsupported.controls.feedback.hidden, false);
  assert.equal(unsupported.controls.retry.hidden, false);
  assert.equal(unsupported.controls.notice.hidden, false);
  assert.match(unsupported.controls.feedbackText.textContent, /仅向有道发送点击的词条/);
  let savedConsent = false;
  unsupported.controls.network.addEventListener('change', () => { savedConsent = true; });
  unsupported.click('retry');
  assert.equal(savedConsent, true, 'retry consent must trigger settings persistence');
  assert.equal(unsupported.controls.network.checked, true);
  assert.equal(unsupported.controls.notice.hidden, true);
  assert.equal(unsupported.players[0].playCalled, true, 'play must run synchronously in the click');
  assert.match(unsupported.players[0].src, /audio=friend&type=2$/);
  assert.equal(unsupported.players[0].playbackRate, .7);
  unsupported.players[0].onplaying();
  assert.equal(unsupported.timers.size, 0);
  unsupported.players[0].onended();
  assert.equal(unsupported.controls.status.textContent, '发音完成');

  const explicit = fixture({ native: true });
  explicit.controls.engine.value = 'online';
  explicit.speech.speak('ice cream');
  assert.equal(explicit.players.length, 0);
  assert.equal(explicit.utterances.length, 0);
  explicit.controls.network.checked = true;
  explicit.controls.lang.value = 'en-GB';
  explicit.speech.speak('ice cream');
  assert.match(explicit.players[0].src, /audio=ice%20cream&type=1$/);
  const staleError = explicit.players[0].onerror;
  explicit.speech.speak('moon');
  assert.equal(explicit.players[0].paused, true);
  assert.equal(explicit.players[0].cleared, true);
  staleError();
  assert.match(explicit.controls.status.textContent, /moon/);
  explicit.players[1].onerror();
  assert.match(explicit.controls.status.textContent, /加载失败/);
  assert.equal(explicit.controls.retry.hidden, false);
  explicit.click('retry');
  explicit.timeout(12000);
  assert.match(explicit.controls.status.textContent, /超时/);
  explicit.click('dismiss');
  assert.equal(explicit.controls.feedback.hidden, true);
  explicit.controls.lang.value = 'ja-JP';
  explicit.change('lang');
  explicit.speech.speak('こんにちは');
  assert.match(explicit.controls.status.textContent, /仅支持英语/);
  assert.equal(explicit.players.length, 3, 'non-English must not be sent to the English service');

  const silent = fixture({ native: true });
  silent.speech.speak('word');
  assert.equal(silent.utterances.length, 1);
  silent.timeout(4000);
  assert.match(silent.controls.feedbackText.textContent, /鸿蒙/);
  assert.equal(silent.players.length, 0, 'timeout must not autoplay online or send a word without consent');
  silent.click('retry');
  assert.equal(silent.players.length, 1);
  silent.speech.speak('next');
  assert.equal(silent.players.length, 2, 'automatic mode remembers broken native service for this session');
  silent.controls.network.checked = false;
  silent.change('network');
  assert.equal(silent.players[1].paused, true, 'revoking consent stops in-flight audio');
  silent.speech.speak('private');
  assert.equal(silent.players.length, 2);
  silent.speech.stop();
  assert.equal(silent.timers.size, 0);

  const broken = fixture({ native: true, throws: true });
  broken.speech.speak('word');
  assert.match(broken.controls.status.textContent, /无法启动/);
  assert.equal(broken.timers.size, 0);
  broken.host.SpeechSynthesisUtterance = class { constructor() { throw new Error('broken constructor'); } };
  broken.speech.speak('again');
  assert.match(broken.controls.status.textContent, /无法启动/);

  const blocked = fixture({ rejection: Object.assign(new Error('gesture'), { name: 'NotAllowedError' }) });
  blocked.controls.network.checked = true;
  blocked.speech.speak('friend');
  await Promise.resolve();
  assert.match(blocked.controls.status.textContent, /阻止了音频播放/);
  assert.equal(blocked.controls.retry.hidden, false);
  assert.equal(blocked.timers.size, 0);
  const unavailable = fixture();
  delete unavailable.host.Audio;
  unavailable.controls.network.checked = true;
  unavailable.speech.speak('friend');
  assert.match(unavailable.controls.status.textContent, /不支持音频/);
  console.log('Speech compatibility, consent, direct-click audio, stale events, startup/load timeout and playback error tests passed.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
