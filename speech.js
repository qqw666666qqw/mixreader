function createReaderSpeech(host, controls) {
  const supported = !!(host.speechSynthesis && host.SpeechSynthesisUtterance);
  let preferredVoice = controls.voice.value;
  const status = message => { controls.status.textContent = message; };
  function voices() {
    if (!supported) return [];
    const lang = controls.lang.value.toLowerCase();
    return host.speechSynthesis.getVoices().filter(voice =>
      voice.lang.toLowerCase().split('-')[0] === lang.split('-')[0]);
  }
  function refresh() {
    const saved = controls.voice.value || preferredVoice;
    controls.voice.replaceChildren(new Option('自动选择', ''));
    for (const voice of voices()) controls.voice.add(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · 本机' : ''}`, voice.voiceURI));
    if (voices().some(voice => voice.voiceURI === saved)) controls.voice.value = saved;
    if (!supported) status('此浏览器不支持发音，请在 Safari、Chrome 或 Edge 中打开');
    else status('点词条旁的发音按钮；可用声音取决于手机，部分声音需联网。');
  }
  let active;
  function speak(text) {
    if (!supported) { status('当前浏览器不支持发音'); return; }
    if (!text || text.length > 200) return;
    const available = voices();
    const all = host.speechSynthesis.getVoices();
    if (all.length && !available.length) { status('设备没有该语言的声音，请检查系统语音设置或切换语言'); return; }
    host.speechSynthesis.cancel();
    const utterance = new host.SpeechSynthesisUtterance(text);
    utterance.lang = controls.lang.value;
    utterance.rate = Math.max(.6, Math.min(1.4, Number(controls.rate.value) || .9));
    utterance.voice = available.find(voice => voice.voiceURI === controls.voice.value) ||
      available.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase() && voice.default) ||
      available.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase() && /Samantha|Daniel|Tingting|Kyoko|Yuna|Thomas/i.test(voice.name)) ||
      available.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase() && voice.localService) ||
      available.find(voice => voice.lang.toLowerCase() === utterance.lang.toLowerCase()) || available[0] || null;
    active = utterance;
    status(`正在发音：${text}`);
    utterance.onend = () => { if (active === utterance) status('发音完成'); };
    utterance.onerror = event => {
      if (active !== utterance || event.error === 'interrupted' || event.error === 'canceled') return;
      status('发音失败，请检查网络或设备声音设置后重试');
    };
    host.speechSynthesis.speak(utterance);
  }
  if (supported) host.speechSynthesis.addEventListener('voiceschanged', refresh);
  controls.voice.addEventListener('change', () => { preferredVoice = controls.voice.value; });
  controls.lang.addEventListener('change', refresh);
  controls.stop.addEventListener('click', () => {
    if (supported) host.speechSynthesis.cancel();
    active = null;
    status('已停止发音');
  });
  refresh();
  return {
    speak, refresh,
    voicePreference: () => controls.voice.value || preferredVoice,
    setVoice(value) { preferredVoice = value || ''; refresh(); },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createReaderSpeech };
