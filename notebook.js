(() => {
  const store = window.readerMemory.store;
  const channel = typeof window.BroadcastChannel === 'function' ? new window.BroadcastChannel('jiadu-vocabulary') : null;
  let records = [], selected, selectionVersion = 0, refreshVersion = 0;
  let managing = false, busy = false, notebookOpen = false, libraryReady = false, readingAnchor, readingY = 0, toastTimer;
  const message = text => { $('notebookStatus').textContent = text; };
  const posHtml = pos => pos ? `<span class="nb-pos" data-pos="${escapeHtml(pos)}">${escapeHtml(vocabularyPosLabel(pos))}</span>` : '';
  const speaker = '<svg class="nb-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4V5Zm4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>';

  function toast(text) {
    clearTimeout(toastTimer);
    $('notebookToast').textContent = text; $('notebookToast').hidden = false;
    toastTimer = setTimeout(() => { $('notebookToast').hidden = true; }, 2500);
  }

  function render() {
    const query = $('notebookSearch').value.trim().toLowerCase();
    const shown = records.filter(record => `${record.word} ${record.meaning} ${vocabularyPosLabel(record.pos)}`.toLowerCase().includes(query));
    $('notebookCount').textContent = $('notebookTotal').textContent = records.length;
    $('exportNotebook').disabled = busy || !records.length;
    $('manageNotebook').textContent = managing ? '完成' : '管理';
    $('manageNotebook').setAttribute('aria-pressed', String(managing));
    $('notebookCaption').textContent = query ? `搜索结果 · ${shown.length}` : '全部生词';
    $('notebookList').innerHTML = shown.map(record => `<li class="nb-card"><div><h2 class="nb-word" dir="auto">${escapeHtml(record.word)}</h2><div class="nb-definition">${posHtml(record.pos)}<p class="nb-meaning">${escapeHtml(record.meaning)}</p></div></div>${managing
      ? `<button type="button" class="nb-remove" data-remove-word="${escapeHtml(record.id)}" ${busy ? 'disabled' : ''} aria-label="移除 ${escapeHtml(record.word)}">移除</button>`
      : `<button type="button" class="nb-speak" data-vocabulary-speak="${escapeHtml(record.id)}" aria-label="发音：${escapeHtml(record.word)}">${speaker}<span>发音</span></button>`}</li>`).join('');
    $('notebookEmpty').hidden = !!records.length;
    $('notebookNoResults').hidden = !records.length || !query || !!shown.length;
  }

  async function refresh() {
    const version = ++refreshVersion;
    const saved = await store.all('vocabulary');
    if (version !== refreshVersion) return;
    records = saved.map(normalizeVocabulary);
    render();
  }

  function route() {
    const next = location.hash === '#vocabulary';
    if (next === notebookOpen) return;
    window.readerSpeech.stop();
    if (next) {
      readingAnchor = window.readerMemory.capture(); readingY = window.scrollY;
      if (libraryReady) window.readerMemory.changed('progress', readingAnchor);
    } else {
      readingAnchor = window.readerMemory.capture();
    }
    notebookOpen = next;
    window.readerMemory.setNotebookOpen?.(next);
    document.body.classList.toggle('notebook-open', next);
    $('notebookView').hidden = !next;
    if (next) {
      window.scrollTo(0, 0);
      refresh().catch(error => message(`生词本读取失败：${error.message}`));
    } else if (readingAnchor?.view === 'reader') window.readerMemory.restorePosition(readingAnchor);
    else window.scrollTo(0, readingY);
  }

  async function open(word, zh) {
    const entry = state.wordDetails?.get(JSON.stringify([zh, word]));
    const version = ++selectionVersion;
    try {
      selected = normalizeVocabulary({ word, meaning: entry?.meaning || zh, pos: entry?.pos || '', lang: $('speechLang').value });
    } catch (error) { toast(`无法收藏：${error.message}`); return; }
    $('collectTerm').textContent = selected.word;
    $('collectMeaning').textContent = selected.meaning;
    $('collectPos').innerHTML = posHtml(selected.pos);
    $('collectStatus').textContent = '正在检查收藏…';
    $('collectVocabulary').disabled = true;
    $('collectVocabulary').textContent = '加入生词本';
    if (!$('vocabularyDialog').open) $('vocabularyDialog').showModal();
    try {
      const existing = await store.get('vocabulary', selected.id);
      if (version !== selectionVersion) return;
      $('collectVocabulary').disabled = !!existing;
      $('collectVocabulary').textContent = existing ? '已加入生词本' : '加入生词本';
      $('collectStatus').textContent = existing ? '已保存在当前浏览器。' : '词条和释义直接来自你的词书。';
    } catch (error) {
      if (version === selectionVersion) $('collectStatus').textContent = `无法保存生词：${error.message}`;
    }
  }

  function speak(record) {
    const currentLang = $('speechLang').value;
    const lang = currentLang.split('-')[0] === record.lang.split('-')[0] ? currentLang
      : [...$('speechLang').options].some(option => option.value === record.lang) ? record.lang : 'en-US';
    if ($('speechLang').value !== lang) {
      $('speechLang').value = lang;
      $('speechLang').dispatchEvent(new Event('change', { bubbles: true }));
    }
    window.readerSpeech.speak(record.word);
  }

  $('openNotebook').addEventListener('click', () => { location.hash = 'vocabulary'; });
  $('openNotebookBottom').addEventListener('click', () => { location.hash = 'vocabulary'; });
  document.querySelectorAll('[data-return-reading]').forEach(button => button.addEventListener('click', () => { location.hash = 'reading'; }));
  $('closeVocabularyDialog').addEventListener('click', () => { selectionVersion++; $('vocabularyDialog').close(); });
  $('vocabularyDialog').addEventListener('cancel', () => { selectionVersion++; });
  $('speakCollectTerm').addEventListener('click', () => {
    const record = selected;
    $('vocabularyDialog').close();
    if (record) speak(record);
  });
  $('collectVocabulary').addEventListener('click', async () => {
    if (!selected || $('collectVocabulary').disabled) return;
    const record = selected;
    const version = selectionVersion;
    $('collectVocabulary').disabled = true;
    $('collectStatus').textContent = '正在保存…';
    try {
      const result = await store.collectWord(record);
      channel?.postMessage({ type: 'changed' });
      await refresh();
      if (version === selectionVersion) $('vocabularyDialog').close();
      toast(result.added ? `${record.word} 已加入生词本` : '这个词已在生词本中');
    } catch (error) {
      if (version === selectionVersion) {
        $('collectStatus').textContent = `收藏失败：${error.name === 'QuotaExceededError' ? '本机空间不足' : error.message}。尚未保存，请重试。`;
        $('collectVocabulary').disabled = false;
      }
    }
  });
  $('notebookSearch').addEventListener('input', render);
  $('manageNotebook').addEventListener('click', () => { managing = !managing; render(); });
  $('notebookList').addEventListener('click', async event => {
    const audio = event.target.closest('[data-vocabulary-speak]');
    if (audio) { const record = records.find(record => record.id === audio.dataset.vocabularySpeak); if (record) speak(record); return; }
    const remove = event.target.closest('[data-remove-word]');
    const record = remove && records.find(record => record.id === remove.dataset.removeWord);
    if (!record || busy || !window.confirm(`从生词本移除“${record.word}（${record.meaning}）”？不会删除词书和中文书。`)) return;
    busy = true; render();
    try {
      await store.deleteWord(record.id); channel?.postMessage({ type: 'changed' });
      await refresh(); message(`已移除 ${record.word}`);
    } catch (error) { message(`移除失败：${error.message}`); }
    finally { busy = false; render(); }
  });
  $('exportNotebook').addEventListener('click', () => {
    if (!records.length) return;
    try {
      if (!window.XLSX) throw new Error('Excel 组件未加载，请刷新');
      const workbook = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet(vocabularyExcelRows(records));
      sheet['!cols'] = [{ wch: 24 }, { wch: 15 }, { wch: 40 }];
      XLSX.utils.book_append_sheet(workbook, sheet, '生词本');
      const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
      downloadBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '夹读-生词本.xlsx');
      message('已生成 Excel：单词、词性、中文释义。发音在网站中播放，Excel 不嵌入音频。');
    } catch (error) { message(`导出失败：${error.message}`); }
  });
  channel?.addEventListener('message', event => {
    if (event.data?.type === 'changed') refresh().catch(error => message(error.message));
  });
  window.addEventListener('hashchange', route);
  window.readerVocabulary = { open, refresh };
  window.readerMemory.ready.then(() => { libraryReady = true; return refresh(); }).catch(error => message(`生词本读取失败：${error.message}`));
  route();
})();
