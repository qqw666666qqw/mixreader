// Small transactional records for progress; large texts are written only on import.
function createReaderStore(indexedDB) {
  let database;
  const ready = new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error('当前浏览器无法保存书籍，请不要使用无痕模式')); return; }
    const request = indexedDB.open('jiadu-personal-reader', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['books', 'wordbooks', 'sessions', 'meta']) {
        db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      database = request.result;
      database.onversionchange = () => database.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('存储正在更新，请关闭其他夹读页面后重试'));
  });
  async function transaction(names, mode, action) {
    await ready;
    return new Promise((resolve, reject) => {
      const tx = database.transaction(names, mode);
      let value;
      tx.oncomplete = () => resolve(value);
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('本机保存失败'));
      action(tx, result => { value = result; });
    });
  }
  return {
    ready,
    get: (name, id) => transaction([name], 'readonly', (tx, done) => {
      const request = tx.objectStore(name).get(id);
      request.onsuccess = () => done(request.result);
    }),
    all: name => transaction([name], 'readonly', (tx, done) => {
      const request = tx.objectStore(name).getAll();
      request.onsuccess = () => done(request.result);
    }),
    write: records => transaction(Object.keys(records), 'readwrite', tx => {
      for (const [name, items] of Object.entries(records)) {
        for (const item of items) tx.objectStore(name).put(item);
      }
    }),
    deleteBook: id => transaction(['books', 'sessions', 'meta'], 'readwrite', tx => {
      tx.objectStore('books').delete(id);
      tx.objectStore('sessions').delete(id);
      const request = tx.objectStore('meta').get('current');
      request.onsuccess = () => {
        if (request.result?.bookId === id) tx.objectStore('meta').put({ ...request.result, bookId: null });
      };
    }),
  };
}

function validateReaderBackup(data) {
  if (!data || data.format !== 'jiadu-backup' || data.version !== 1) throw new Error('不是受支持的夹读备份文件');
  const result = {};
  for (const name of ['books', 'wordbooks', 'sessions', 'meta']) {
    if (!Array.isArray(data[name]) || data[name].length > 10000) throw new Error('备份结构不完整');
    const ids = new Set();
    result[name] = data[name].map(item => {
      if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 200 || ids.has(item.id)) throw new Error('备份记录标识无效或重复');
      ids.add(item.id);
      if (name === 'books' || name === 'wordbooks') {
        if (typeof item.text !== 'string' || typeof item.name !== 'string') throw new Error('备份缺少书籍正文');
        if (item.excel) {
          if (!Array.isArray(item.excel.sheets) || item.excel.sheets.length > 1000) throw new Error('Excel 备份无效');
          for (const sheet of item.excel.sheets) {
            if (typeof sheet.name !== 'string' || !Array.isArray(sheet.rows) || !sheet.rows.every(row =>
              Array.isArray(row) && row.every(cell => typeof cell === 'string'))) throw new Error('Excel 表格备份无效');
          }
        }
      }
      return item;
    });
  }
  const books = new Set(result.books.map(item => item.id));
  const words = new Set(result.wordbooks.map(item => item.id));
  for (const session of result.sessions) {
    if (!books.has(session.id) || (session.wordbookId && !words.has(session.wordbookId))) throw new Error('备份缺少关联的书籍或词书');
  }
  for (const meta of result.meta) {
    if (meta.id !== 'current' || (meta.bookId && !books.has(meta.bookId)) ||
        (meta.wordbookId && !words.has(meta.wordbookId))) throw new Error('备份的当前书籍关联无效');
  }
  return result;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createReaderStore, validateReaderBackup };
