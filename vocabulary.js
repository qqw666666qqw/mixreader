// Vocabulary records contain only dictionary content and the language needed for speech.
function normalizeVocabulary(item) {
  if (!item || typeof item.word !== 'string' || typeof item.meaning !== 'string' ||
      (item.pos != null && typeof item.pos !== 'string') || typeof item.lang !== 'string') throw new Error('生词记录无效');
  const word = item.word.trim().normalize('NFC');
  const meaning = item.meaning.trim();
  const pos = (item.pos || '').trim();
  const lang = item.lang;
  if (!word || word.length > 200 || !meaning || meaning.length > 2000 || pos.length > 100 ||
      !/^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(lang)) throw new Error('生词记录内容无效');
  const id = JSON.stringify([lang.toLowerCase().split('-')[0], word.toLowerCase(), meaning]);
  return { id, word, meaning, pos, lang };
}

function vocabularyExcelRows(words) {
  return [['单词', '词性', '中文释义'], ...words.map(item => [item.word, item.pos || '', item.meaning])];
}

function vocabularyPosLabel(pos) {
  const names = { 'n.': '名词', 'v.': '动词', 'vt.': '及物动词', 'vi.': '不及物动词', 'adj.': '形容词', 'adv.': '副词', 'prep.': '介词', 'pron.': '代词', 'conj.': '连词', 'num.': '数词', 'art.': '冠词', 'aux.': '助动词', 'interj.': '感叹词', 'int.': '感叹词' };
  return pos.split(' / ').map(value => names[value] ? `${value} ${names[value]}` : value).join(' / ');
}

if (typeof module !== 'undefined' && module.exports) module.exports = { normalizeVocabulary, vocabularyExcelRows, vocabularyPosLabel };
