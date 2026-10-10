// Excel wordbooks use explicit columns so unrelated cells never become definitions.
const EXCEL_HEADERS = {
  target: /^(?:word|words|vocabulary|term|english|英文|英语|单词|英文单词|词汇|词条|目标语|目标语词条)$/i,
  definition: /^(?:meaning|meanings|definition|translation|chinese|中文|中文释义|中文意思|释义|解释|翻译|含义)$/i,
};

function excelCellText(value) {
  return String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim();
}

function suggestExcelColumns(rows) {
  for (let index = 0; index < Math.min(rows.length, 20); index++) {
    const cells = rows[index].map(excelCellText);
    const target = cells.findIndex((cell) => EXCEL_HEADERS.target.test(cell));
    const definition = cells.findIndex((cell) => EXCEL_HEADERS.definition.test(cell));
    if (target >= 0 && definition >= 0 && target !== definition) {
      return { target, definition, startRow: index + 1, header: cells };
    }
  }
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const scores = Array.from({ length: width }, (_, column) => {
    let target = 0, definition = 0;
    for (const row of rows.slice(0, 100)) {
      const cell = excelCellText(row[column]);
      if (/[\u3400-\u9fff]/.test(cell)) definition++;
      else if (/\p{L}/u.test(cell) && cell.length <= 80) target++;
    }
    return { column, target, definition };
  });
  const target = [...scores].sort((a, b) => b.target - a.target)[0]?.column ?? 0;
  const definition = scores.filter((score) => score.column !== target)
    .sort((a, b) => b.definition - a.definition)[0]?.column ?? -1;
  return { target, definition, startRow: 0, header: [] };
}

function excelRowsToWordbook(rows, { target, definition, startRow = 0 }) {
  if (target < 0 || definition < 0 || target === definition) {
    throw new Error('请选择不同的单词列和中文释义列；只有英文单词的表格无法替换中文');
  }
  const lines = [];
  let skipped = 0;
  for (const row of rows.slice(startRow)) {
    const word = excelCellText(row[target]);
    const meaning = excelCellText(row[definition]);
    if (!word || !/[\u3400-\u9fff]/.test(meaning) ||
        EXCEL_HEADERS.target.test(word) || EXCEL_HEADERS.definition.test(meaning)) {
      skipped++;
      continue;
    }
    lines.push(`${word}\t${meaning}`);
  }
  if (!lines.length) throw new Error('所选列没有有效的“单词 + 中文释义”，请检查列选择或补充中文释义');
  return { text: lines.join('\n'), count: lines.length, skipped };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { excelCellText, suggestExcelColumns, excelRowsToWordbook };
}
