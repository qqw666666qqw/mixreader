function createReaderSpeech(host, controls) {
  const synthesis = host.speechSynthesis;
  const supported = !!(synthesis && host.SpeechSynthesisUtterance &&
    typeof synthesis.speak === 'function' && typeof synthesis.getVoices === 'function');
  const schedule = host.setTimeout?.bind(host) || setTimeout;
  const unschedule = host.clearTimeout?.bind(host) || clearTimeout;
  let preferredVoice = controls.voice.value;
  let active, audio, timer, fallbackText;
  let nativeFailed = false;
  const isEnglish = () => /^en(?:-|$)/i.test(controls.lang.value);
  const networkAllowed = () => !!controls.network?.checked;
  function status(message, visible = false) {
    controls.status.textContent = message;
    if (controls.feedbackText) controls.feedbackText.textContent = message;
    if (visible && controls.feedback) controls.feedback.hidden = false;
  }
  function offerNetwork(text) {
    fallbackText = isEnglish() ? text : null;
    if (!controls.retry) return;
    controls.retry.hidden = !fallbackText;
    controls.retry.textContent = networkAllowed() ? '改用联网发音' : '同意联网并发音';
    if (controls.notice) controls.notice.hidden = !fallbackText || networkAllowed();
  }
  function cleanup() {
    active = null;
    unschedule(timer);
    timer = null;
    try { synthesis?.cancel(); } catch (_) { /* Some browsers expose an unusable speech service. */ }
    if (audio) {
      audio.onplaying = audio.onended = audio.onerror = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      audio = null;
    }
    fallbackText = null;
    if (controls.retry) controls.retry.hidden = true;
    if (controls.notice) controls.notice.hidden = true;
  }
  function voices() {
    if (!supported) return [];
    const lang = controls.lang.value.toLowerCase().split('-')[0];
    try { return synthesis.getVoices().filter(voice => voice.lang.toLowerCase().split('-')[0] === lang); }
    catch (_) { return []; }
  }
  function refresh() {
    const saved = controls.voice.value || preferredVoice;
    const available = voices();
    controls.voice.replaceChildren(new Option('自动选择', ''));
    for (const voice of available) controls.voice.add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · 本机' : ''}`, voice.voiceURI));
    if (available.some(voice => voice.voiceURI === saved)) controls.voice.value = saved;
    controls.voice.disabled = controls.engine?.value === 'online';
    if (active) return;
    if (!supported || !available.length) status('未检测到该语言的设备声音；鸿蒙等设备可开启英文联网发音。');
    else status('点词条旁的发音按钮；系统无声时可改用英文联网发音。');
  }
  function online(text) {
    if (!isEnglish()) {
      status('联网发音目前仅支持英语；其他语言请使用设备声音。', true);
      return;
    }
    if (!networkAllowed()) {
      status('英文联网发音需要你的同意：仅将点击的词条发送给有道，不发送书籍正文；需要联网。', true);
      offerNetwork(text);
      return;
    }
    if (!host.Audio) { status('此浏览器不支持音频播放，请在系统浏览器中打开。', true); return; }
    const token = {};
    active = token;
    status(`正在载入英文发音：${text}`, true);
    function fail(message) {
      if (active !== token) return;
      cleanup();
      status(message, true);
      offerNetwork(text);
    }
    try {
      const player = new host.Audio();
      audio = player;
      player.preload = 'none';
      player.playbackRate = Math.max(.6, Math.min(1.4, Number(controls.rate.value) || .9));
      player.onplaying = () => {
        if (active !== token) return;
        unschedule(timer);
        status(`正在联网发音：${text}`, true);
      };
      player.onended = () => {
        if (active !== token) return;
        cleanup();
        status('发音完成', true);
      };
      player.onerror = () => fail('联网发音加载失败，请检查网络后重试；第三方服务可能暂时不可用。');
      // Call play directly in the user's click, not after fetch/await: mobile browsers require a gesture.
      player.src = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${controls.lang.value === 'en-GB' ? 1 : 2}`;
      timer = schedule(() => fail('联网发音加载超时，请检查网络后重新点击发音。'), 12000);
      const playing = player.play();
      playing?.catch(error => fail(error.name === 'NotAllowedError'
        ? '浏览器阻止了音频播放，请再次点击“改用联网发音”，并检查媒体音量。'
        : '联网发音播放失败，请检查网络和媒体音量后重试。'));
    } catch (_) { fail('联网发音无法启动，请检查浏览器的音频权限后重试。'); }
  }
  function device(text) {
    if (!supported) {
      status('当前浏览器不支持系统发音。英文可开启联网发音；仅向有道发送点击的词条，不发送书籍正文。', true);
      offerNetwork(text);
      return;
    }
    const available = voices();
    try {
      if (!available.length && synthesis.getVoices().length) {
        status('设备没有该语言的声音；英文可改用联网发音，其他语言请检查设备语音设置。', true);
        offerNetwork(text);
        return;
      }
    } catch (_) { /* Empty or inaccessible voices can still be attempted through the default service. */ }
    let utterance;
    const token = {};
    active = token;
    const failed = message => {
      if (active !== token) return;
      nativeFailed = true;
      cleanup();
      status(message, true);
      offerNetwork(text);
    };
    try {
      utterance = new host.SpeechSynthesisUtterance(text);
      utterance.lang = controls.lang.value;
      utterance.rate = Math.max(.6, Math.min(1.4, Number(controls.rate.value) || .9));
      utterance.voice = available.find(voice => voice.voiceURI === controls.voice.value) ||
        available.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase() && voice.default) ||
        available.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase() && /Samantha|Daniel|Tingting|Kyoko|Yuna|Thomas/i.test(voice.name)) ||
        available.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase() && voice.localService) ||
        available.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase()) || available[0] || null;
      status(`正在启动系统发音：${text}`, true);
      offerNetwork(text);
      utterance.onstart = () => {
        if (active !== token) return;
        unschedule(timer);
        status(`正在系统发音：${text}；若无声，请检查媒体音量或改用联网发音。`, true);
      };
      utterance.onend = () => {
        if (active !== token) return;
        cleanup();
        status('发音完成', true);
      };
      utterance.onerror = event => {
        if (event.error === 'interrupted' || event.error === 'canceled') {
          if (active === token) { cleanup(); status('系统发音已中断，请重新点击发音。', true); }
          return;
        }
        failed('系统发音失败；英文可改用联网发音，其他语言请检查设备语音设置。');
      };
      timer = schedule(() => failed('系统发音未能启动；部分鸿蒙浏览器没有可用的系统语音，英文可改用联网发音。'), 4000);
      synthesis.speak(utterance);
    } catch (_) { failed('系统发音无法启动；英文可改用联网发音。'); }
  }
  function speak(text, forceOnline = false) {
    if (typeof text !== 'string' || !text.trim() || text.length > 200) return;
    cleanup();
    const mode = controls.engine?.value || 'auto';
    if (forceOnline || mode === 'online' || (mode === 'auto' && isEnglish() &&
      networkAllowed() && (!supported || !voices().length || nativeFailed))) online(text.trim());
    else device(text.trim());
  }
  function stop() { cleanup(); status('已停止发音'); }
  if (supported) synthesis.addEventListener?.('voiceschanged', refresh);
  controls.voice.addEventListener('change', () => { preferredVoice = controls.voice.value; });
  controls.lang.addEventListener('change', () => { cleanup(); nativeFailed = false; refresh(); });
  controls.engine?.addEventListener('change', () => { cleanup(); refresh(); });
  controls.network?.addEventListener('change', () => { cleanup(); refresh(); });
  controls.stop.addEventListener('click', stop);
  controls.dismiss?.addEventListener('click', () => { stop(); controls.feedback.hidden = true; });
  controls.retry?.addEventListener('click', () => {
    const text = fallbackText;
    if (!text) return;
    if (controls.network && !controls.network.checked) {
      controls.network.checked = true;
      controls.network.dispatchEvent(new host.Event('change', { bubbles: true }));
    }
    // The retry button is another explicit gesture, including after a system startup timeout.
    nativeFailed = true;
    speak(text, true);
  });
  refresh();
  return {
    speak, refresh, stop,
    voicePreference: () => controls.voice.value || preferredVoice,
    setVoice(value) { preferredVoice = value || ''; refresh(); },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createReaderSpeech };
