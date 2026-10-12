// Personal library is shared by both theme URLs because IndexedDB is origin-scoped.
(() => {
  const store = createReaderStore(window.indexedDB);
  const status = (message, error = false) => {
    $('saveStatus').textContent = message;
    $('saveStatus').classList.toggle('err', error);
  };
  let bookId = null, wordbookId = null, loading = true, revision = 0;
  let queue = Promise.resolve(), timer, restoringPosition = false;
  let storageFailed = false;
  let backupUrl;
  let lastReadingAnchor, anchorBook, anchorChapter;
  const settingsIds = ['notesMode', 'minLen', 'density', 'fontSize', 'wbEnc', 'bkEnc', 'speechLang', 'speechVoice', 'speechRate'];
  const checkIds = ['strictMode', 'speakOnWord'];
  window.readerSpeech = createReaderSpeech(window, {
    lang: $('speechLang'), voice: $('speechVoice'), rate: $('speechRate'),
    stop: $('stopSpeech'), status: $('speechStatus'),
  });

  function settings() {
    const result = { mode: opts().mode };
    for (const id of settingsIds) result[id] = $(id).value;
    result.speechVoice = window.readerSpeech.voicePreference();
    for (const id of checkIds) result[id] = $(id).checked;
    return result;
  }
  function applySettings(value = {}) {
    for (const id of settingsIds) {
      if (id === 'speechVoice') continue;
      const element = $(id);
      if (typeof value[id] !== 'string') continue;
      if (element.tagName === 'SELECT') {
        if ([...element.options].some(option => option.value === value[id])) element.value = value[id];
      } else if (Number.isFinite(Number(value[id]))) {
        element.value = String(Math.min(Number(element.max), Math.max(Number(element.min), Number(value[id]))));
      }
    }
    for (const id of checkIds) if (typeof value[id] === 'boolean') $(id).checked = value[id];
    if (['en', 'enzh', 'zhen'].includes(value.mode)) document.querySelector(`input[name="mode"][value="${value.mode}"]`).checked = true;
    window.readerSpeech.refresh();
    window.readerSpeech.setVoice(value.speechVoice);
    if ([...$('speechVoice').options].some(option => option.value === value.speechVoice)) $('speechVoice').value = value.speechVoice;
    $('densityOut').textContent = $('density').value + '%';
  }

  async function contentId(prefix, text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return prefix + ':' + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function pointRange(element, offset) {
    const range = document.createRange();
    if (element.dataset.sourceText === 'true' && element.firstChild?.nodeType === Node.TEXT_NODE) {
      const length = element.firstChild.textContent.length;
      const start = Math.min(offset, Math.max(0, length - 1));
      range.setStart(element.firstChild, start);
      range.setEnd(element.firstChild, Math.min(length, start + 1));
    } else range.selectNodeContents(element.querySelector('.w') || element);
    return range;
  }

  function capture() {
    if (!state.bk || !state.res) return { view: 'top', offset: 0 };
    if (anchorBook !== state.bk || anchorChapter !== state.chapterIndex) {
      lastReadingAnchor = null; anchorBook = state.bk; anchorChapter = state.chapterIndex;
    }
    const page = $('page');
    const rect = page.getBoundingClientRect();
    if (rect.top > window.innerHeight - 30) return lastReadingAnchor || { view: 'top', offset: 0 };
    const y = 70;
    const spans = page.querySelectorAll('[data-source-start]');
    for (const span of spans) {
      const bounds = span.getBoundingClientRect();
      if (bounds.bottom < y) continue;
      let index = 0;
      const length = Number(span.dataset.sourceLength);
      if (span.dataset.sourceText === 'true' && length > 1 && bounds.top < y) {
        let low = 0, high = length - 1;
        while (low < high) {
          const mid = Math.floor((low + high) / 2);
          const at = pointRange(span, mid).getBoundingClientRect();
          if (at.bottom < y) low = mid + 1;
          else high = mid;
        }
        index = low;
      }
      const at = pointRange(span, index).getBoundingClientRect();
      lastReadingAnchor = { view: 'reader', offset: Number(span.dataset.sourceStart) + index, y: Math.max(0, Math.min(window.innerHeight, at.top)) };
      return lastReadingAnchor;
    }
    lastReadingAnchor = { view: 'reader', offset: currentChapter().text.length, y: 70 };
    return lastReadingAnchor;
  }

  function restorePosition(anchor) {
    if (!anchor) return;
    anchorBook = state.bk; anchorChapter = state.chapterIndex;
    if (anchor.view === 'reader') lastReadingAnchor = anchor;
    restoringPosition = true;
    requestAnimationFrame(() => {
      if (anchor.view !== 'reader') window.scrollTo(0, 0);
      else {
        const spans = [...$('page').querySelectorAll('[data-source-start]')];
        const offset = Math.max(0, Math.min(Number(anchor.offset) || 0, currentChapter().text.length));
        const span = spans.find(element => Number(element.dataset.sourceStart) + Number(element.dataset.sourceLength) > offset) || spans.at(-1);
        if (span) {
          const at = pointRange(span, Math.max(0, offset - Number(span.dataset.sourceStart))).getBoundingClientRect();
          window.scrollTo(0, window.scrollY + at.top - (Number(anchor.y) || 70));
        }
      }
      requestAnimationFrame(() => { restoringPosition = false; });
    });
  }

  function excelSnapshot() {
    if (!state.excel) return null;
    return {
      sheets: state.excel.workbook.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(
        state.excel.workbook.Sheets[name], { header: 1, raw: false, defval: '', blankrows: false }
      ).map(row => row.map(excelCellText)) })),
      sheet: $('excelSheet').value, target: $('excelTarget').value, definition: $('excelDefinition').value,
    };
  }

  async function refreshLibrary() {
    const books = await store.all('books');
    books.sort((a, b) => b.updatedAt - a.updatedAt);
    $('savedBooks').innerHTML = '<option value="">选择已保存的书籍</option>' + books.map(book =>
      `<option value="${escapeHtml(book.id)}">${escapeHtml(book.name)}</option>`).join('');
    $('savedBooks').value = bookId || '';
    $('openSavedBook').disabled = $('deleteSavedBook').disabled = !books.length;
  }

  function enqueue(task) {
    queue = queue.then(task).catch(error => {
      storageFailed = true;
      status(`本机保存失败：${error?.name === 'QuotaExceededError' ? '空间不足，请备份并删除不用的书籍' : error.message || '浏览器拒绝存储'}。当前内容仍可阅读，请先备份。`, true);
    });
    return queue;
  }

  function changed(kind, anchor) {
    revision++;
    if (loading) return;
    if (storageFailed && ['all', 'book', 'wordbook'].includes(kind)) kind = 'all';
    clearTimeout(timer);
    const snapshot = {
      bk: state.bk, bkName: state.bkName, wb: state.wb, wbName: state.wbName,
      chapter: state.chapterIndex, anchor: anchor || capture(), settings: settings(),
      excel: ['all', 'wordbook'].includes(kind) ? excelSnapshot() : undefined,
    };
    const content = ['all', 'book', 'wordbook'].includes(kind);
    if (content) status('正在保存到本机…');
    return enqueue(async () => {
      if (storageFailed && !content) return;
      const records = { meta: [], sessions: [] };
      const now = Date.now();
      if ((kind === 'book' || kind === 'all') && snapshot.bk != null) {
        bookId = await contentId('book', snapshot.bk);
        records.books = [{ id: bookId, name: snapshot.bkName, text: snapshot.bk, updatedAt: now }];
      }
      if ((kind === 'wordbook' || kind === 'all') && snapshot.wb != null) {
        wordbookId = await contentId('wordbook', snapshot.wb + '\0' + JSON.stringify(snapshot.excel || null));
        records.wordbooks = [{ id: wordbookId, name: snapshot.wbName, text: snapshot.wb, excel: snapshot.excel, updatedAt: now }];
      }
      records.meta.push({ id: 'current', bookId, wordbookId, settings: snapshot.settings, updatedAt: now });
      if (bookId && snapshot.bk != null) records.sessions.push({ id: bookId, wordbookId, chapter: snapshot.chapter, anchor: snapshot.anchor, settings: snapshot.settings, updatedAt: now });
      await store.write(records);
      storageFailed = false;
      if (content) await refreshLibrary();
      status(`已保存到本机${bookId ? ' · 第 ' + (snapshot.chapter + 1) + ' 章' : ''}；下次用同一浏览器打开可恢复。`);
    });
  }

  function restoreExcel(saved) {
    state.excel = null;
    $('excelOptions').hidden = true;
    $('wbEnc').hidden = false;
    if (!saved?.excel || !window.XLSX) return;
    const workbook = XLSX.utils.book_new();
    for (const sheet of saved.excel.sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(sheet.rows), sheet.name);
    state.excel = { workbook, name: saved.name };
    $('excelOptions').hidden = false;
    $('wbEnc').hidden = true;
    $('excelSheet').innerHTML = workbook.SheetNames.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    $('excelSheet').value = saved.excel.sheet;
    if (!$('excelSheet').value) $('excelSheet').value = workbook.SheetNames[0];
    selectExcelSheet();
    $('excelTarget').value = saved.excel.target;
    $('excelDefinition').value = saved.excel.definition;
    $('excelSummary').textContent = '已从本机恢复工作表与选列，可调整后重新生成。';
  }

  async function openBook(id, initial = false) {
    const version = revision;
    const [book, session, meta] = await Promise.all([store.get('books', id), store.get('sessions', id), store.get('meta', 'current')]);
    if (!book) throw new Error('该书籍已不存在，请重新导入');
    const wbId = session?.wordbookId || meta?.wordbookId;
    const wordbook = wbId ? await store.get('wordbooks', wbId) : null;
    if (initial && revision !== version) return;
    bookId = book.id; wordbookId = wordbook?.id || null;
    state.bk = book.text; state.bkName = book.name;
    state.wb = wordbook?.text ?? null; state.wbName = wordbook?.name || '';
    applySettings(session?.settings || meta?.settings);
    restoreExcel(wordbook);
    prepareBook();
    state.chapterIndex = Math.max(0, Math.min(Number(session?.chapter) || 0, state.chapters.length - 1));
    $('bkStatus').textContent = `已恢复：${book.name}（${state.chapters.length} 章/部分）`;
    $('bkZone').classList.add('ok'); $('wbZone').classList.toggle('ok', !!wordbook);
    $('bkStatus').classList.remove('err'); $('wbStatus').classList.remove('err');
    $('wbStatus').textContent = wordbook ? `已恢复：${wordbook.name}` : '请导入目标语词书';
    if (state.wb) generate();
    else {
      state.res = null; $('page').innerHTML = '<div class="empty"><p>中文书已恢复，请导入词书继续阅读。</p></div>';
      $('vocab').innerHTML = ''; $('cleanReport').hidden = true;
      $('exportBtn').disabled = $('exportHtmlBtn').disabled = true;
      $('statsText').textContent = '等待词书…'; renderChapterNav();
    }
    $('savedBooks').value = bookId;
    status(`已恢复本机书籍与进度 · 第 ${state.chapterIndex + 1} 章`);
    restorePosition(session?.anchor || { view: 'reader', offset: 0, y: 70 });
    if (!initial) changed('progress', session?.anchor || { view: 'reader', offset: 0, y: 70 });
  }

  window.readerMemory = { changed, capture, restorePosition };
  const ready = (async () => {
    try {
      await store.ready;
      const version = revision;
      const meta = await store.get('meta', 'current');
      await refreshLibrary();
      if (revision === version && revision === 0) {
        if (meta?.bookId) await openBook(meta.bookId, true);
        else {
          applySettings(meta?.settings);
          if (meta?.wordbookId) {
            const wordbook = await store.get('wordbooks', meta.wordbookId);
            if (wordbook && revision === 0) {
              wordbookId = wordbook.id; state.wb = wordbook.text; state.wbName = wordbook.name;
              restoreExcel(wordbook); $('wbStatus').textContent = `已恢复：${wordbook.name}`;
              $('wbZone').classList.add('ok');
            }
          }
          status('本机保存已就绪，导入后自动保存；请定期备份。');
        }
      }
      loading = false;
      if (revision > 0) changed('all');
    } catch (error) {
      loading = false;
      status(`无法恢复本机数据：${error.message}。仍可导入阅读，请使用备份保护内容。`, true);
    }
  })();
  window.readerMemory.ready = ready;

  window.addEventListener('scroll', () => {
    if (loading || restoringPosition || !state.bk) return;
    clearTimeout(timer);
    timer = setTimeout(() => changed('progress'), 400);
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { changed('progress'); window.speechSynthesis?.cancel(); }
  });
  window.addEventListener('pagehide', () => changed('progress'));
  ['speechLang', 'speechVoice', 'speechRate', 'speakOnWord'].forEach(id => $(id).addEventListener('change', () => changed('settings')));

  $('openSavedBook').addEventListener('click', async () => {
    try {
      await ready; await changed('progress');
      if ($('savedBooks').value) await openBook($('savedBooks').value);
    } catch (error) { status(error.message, true); }
  });
  $('deleteSavedBook').addEventListener('click', async () => {
    const id = $('savedBooks').value;
    if (!id || !window.confirm('删除所选中文书及其阅读进度？对应词书会保留，建议先备份。')) return;
    try {
      await ready; await queue; await store.deleteBook(id);
      if (bookId === id) {
        bookId = null; state.bk = null; state.bkName = ''; state.res = null; state.chapters = [];
        $('bkStatus').textContent = '已删除，请导入中文书'; $('bkZone').classList.remove('ok');
        $('page').innerHTML = '<div class="empty"><p>请导入中文书，或选择其他已保存的书籍。</p></div>';
        $('vocab').innerHTML = ''; $('statsText').textContent = '等待中文书…';
        $('exportBtn').disabled = $('exportHtmlBtn').disabled = true; renderChapterNav();
      }
      await refreshLibrary(); status('已删除所选中文书及进度。');
    } catch (error) { status(`删除失败：${error.message}`, true); }
  });
  $('persistStorage').addEventListener('click', async () => {
    try {
      if (!navigator.storage?.persist) { status('浏览器不支持申请持久保存，请定期备份。'); return; }
      status(await navigator.storage.persist() ? '浏览器已允许持久保存；主动清理数据仍会删除，请备份。' : '浏览器未批准持久保存；当前仍可本机保存，请定期备份。');
    } catch (error) { status('申请未成功，请定期备份。', true); }
  });
  $('backupLibrary').addEventListener('click', async () => {
    try {
      await ready; await changed('all'); await queue;
      const data = { format: 'jiadu-backup', version: 1, createdAt: new Date().toISOString() };
      for (const name of ['books', 'wordbooks', 'sessions', 'meta']) {
        try { data[name] = await store.all(name); }
        catch (error) { data[name] = []; }
      }
      if (!state.bk && !state.wb && !data.books.length && !data.wordbooks.length) throw new Error('没有可备份的书籍');
      let currentWbId = null;
      if (state.wb != null) {
        const excel = excelSnapshot();
        currentWbId = await contentId('wordbook', state.wb + '\0' + JSON.stringify(excel));
        data.wordbooks = data.wordbooks.filter(item => item.id !== currentWbId);
        data.wordbooks.push({ id: currentWbId, text: state.wb, name: state.wbName, excel });
        data.meta = [{ id: 'current', bookId: null, wordbookId: currentWbId, settings: settings() }];
      }
      // Include current reading content even when a recent quota failure prevented saving it.
      if (state.bk != null) {
        const id = await contentId('book', state.bk);
        data.books = data.books.filter(item => item.id !== id);
        data.books.push({ id, text: state.bk, name: state.bkName, updatedAt: Date.now() });
        const wbId = currentWbId;
        data.sessions = data.sessions.filter(item => item.id !== id);
        data.sessions.push({ id, wordbookId: wbId, chapter: state.chapterIndex, anchor: capture(), settings: settings() });
        data.meta = [{ id: 'current', bookId: id, wordbookId: wbId, settings: settings() }];
      }
      if (backupUrl) URL.revokeObjectURL(backupUrl);
      backupUrl = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
      $('backupDownload').href = backupUrl;
      $('backupDownload').hidden = false;
      status('备份已生成，请点击下方“下载备份文件”。文件含私人正文，请妥善保存。');
    } catch (error) { status(`备份失败：${error.message}`, true); }
  });
  $('restoreLibrary').addEventListener('click', () => $('backupFile').click());
  $('backupFile').addEventListener('change', async () => {
    const file = $('backupFile').files[0];
    if (!file) return;
    try {
      const records = validateReaderBackup(JSON.parse(await file.text()));
      if (!window.confirm(`恢复 ${records.books.length} 本中文书和 ${records.wordbooks.length} 份词书？同一内容的已有进度会由备份覆盖，其他书籍保留。`)) return;
      await ready; await queue;
      await store.write(records); await refreshLibrary();
      const meta = records.meta.find(item => item.id === 'current');
      if (meta?.bookId) await openBook(meta.bookId);
      else if (meta?.wordbookId) {
        const wordbook = await store.get('wordbooks', meta.wordbookId);
        wordbookId = wordbook.id; state.wb = wordbook.text; state.wbName = wordbook.name;
        restoreExcel(wordbook); applySettings(meta.settings); generate();
        $('wbStatus').textContent = `已恢复：${wordbook.name}`;
      }
      status('备份已恢复到本机。');
    } catch (error) { status(`恢复失败：${error.message}`, true); }
    finally { $('backupFile').value = ''; }
  });
})();
