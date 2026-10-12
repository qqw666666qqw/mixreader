const assert = require('node:assert/strict');
const { createReaderStore } = require('../storage.js');

// A request/transaction scheduler that models the async lifetime used by storage.js.
function mockIndexedDB() {
  const stores = new Map(['books', 'wordbooks', 'sessions', 'meta'].map(name => [name, new Map()]));
  let openedVersion;
  const db = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore: name => stores.set(name, new Map()),
    close() {},
    transaction(names) {
      const tx = { pending: 0, done: false };
      function check() {
        queueMicrotask(() => {
          if (!tx.done && !tx.pending) { tx.done = true; tx.oncomplete?.(); }
        });
      }
      function request(action) {
        assert.equal(tx.done, false, 'request must be made inside an active transaction');
        tx.pending++;
        const result = {};
        queueMicrotask(() => {
          result.result = action();
          result.onsuccess?.(); tx.pending--; check();
        });
        return result;
      }
      tx.objectStore = name => {
        assert.ok(names.includes(name));
        const data = stores.get(name);
        assert.ok(data);
        return {
          get: id => request(() => structuredClone(data.get(id))),
          getAll: () => request(() => [...data.values()].map(item => structuredClone(item))),
          put: item => request(() => data.set(item.id, structuredClone(item))),
          delete: id => request(() => data.delete(id)),
        };
      };
      check(); return tx;
    },
  };
  const indexedDB = {
    open(name, version) {
      openedVersion = version;
      const request = { result: db };
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    },
  };
  return { indexedDB, stores, version: () => openedVersion };
}

async function test() {
  const mock = mockIndexedDB();
  mock.stores.get('books').set('book:old', { id: 'book:old', name: 'existing.txt', text: '旧数据' });
  const store = createReaderStore(mock.indexedDB);
  await store.ready;
  assert.equal(mock.version(), 2);
  assert.equal((await store.get('books', 'book:old')).text, '旧数据', 'migration must preserve old books');
  const records = {
    books: [{ id: 'book:a', name: 'same.txt', text: '第一本' }, { id: 'book:b', name: 'same.txt', text: '第二本' }],
    wordbooks: [{ id: 'wordbook:a', name: 'words', text: 'friend 朋友' }],
    sessions: [{ id: 'book:a', wordbookId: 'wordbook:a' }],
    meta: [{ id: 'current', bookId: 'book:a', wordbookId: 'wordbook:a' }],
  };
  await store.write(records);
  await store.deleteBook('book:a');
  assert.equal(await store.get('books', 'book:a'), undefined);
  assert.equal(await store.get('sessions', 'book:a'), undefined);
  assert.equal((await store.get('meta', 'current')).bookId, null);
  assert.equal((await store.get('meta', 'current')).wordbookId, 'wordbook:a');
  assert.ok(await store.get('books', 'book:b'));
  assert.ok(await store.get('wordbooks', 'wordbook:a'));
  assert.deepEqual((await store.write(records)).deletedBookIds, ['book:a']);
  assert.equal(await store.get('books', 'book:a'), undefined, 'stale bulk save must not resurrect deleted content');
  await store.write({ sessions: records.sessions, meta: records.meta });
  assert.equal(await store.get('sessions', 'book:a'), undefined, 'stale progress must not recreate a session');
  assert.equal((await store.get('meta', 'current')).bookId, null);
  await store.write(records, { reviveBooks: true });
  assert.ok(await store.get('books', 'book:a'));
  assert.equal(await store.get('deletedBooks', 'book:a'), undefined, 'explicit reimport clears the tombstone');
  assert.deepEqual((await store.write({ sessions: records.sessions })).deletedBookIds, []);
  console.log('Storage migration, transactional deletion, tombstone write protection and explicit restore tests passed.');
}
test().catch(error => { console.error(error); process.exitCode = 1; });
