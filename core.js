// Core logic for the Chinese-English mixed reader (pure functions, no DOM).
// Shared by the browser app and node-based tests.

const HAN = /[\u4e00-\u9fff]/;

/**
 * Parse a wordbook text file.
 * Supported line formats (one entry per line):
 *   apple 苹果
 *   apple n. 苹果
 *   ice cream 冰淇淋
 *   run vi. 跑；奔跑；经营   (senses split by ；; |)
 * Lines that do not start with an English word, or that contain no Chinese
 * definition, are skipped.
 *
 * Returns { dict, entries, skipped }:
 *   dict    Map zhTerm -> enWord (first entry wins on conflicts)
 *   entries [{en, zh}] every extracted sense
 *   skipped unparseable lines
 */
function parseWordbook(text) {
  const dict = new Map();
  const entries = [];
  const skipped = [];
  // English headword (allows short phrases), then anything containing Chinese.
  const re = /^([A-Za-z][A-Za-z'\-]*(?:\s+[A-Za-z][A-Za-z'\-]*){0,3})\s+(.*[\u4e00-\u9fff].*)$/;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(re);
    if (!m) { skipped.push(line); continue; }
    const en = m[1].trim();
    const def = m[2];
    for (const seg of def.split(/[；;|｜]/)) {
      const cm = seg.match(/[\u4e00-\u9fff]{1,10}/);
      if (!cm) continue;
      const zh = cm[0];
      entries.push({ en, zh });
      if (!dict.has(zh)) dict.set(zh, en);
      // "快乐的" style definitions: also index the bare form "快乐".
      const bare = zh.replace(/[的地得]+$/, '');
      if (bare && bare !== zh) {
        entries.push({ en, zh: bare });
        if (!dict.has(bare)) dict.set(bare, en);
      }
    }
  }
  return { dict, entries, skipped };
}

// Deterministic per-occurrence pseudo random (0..99), used by density control.
function seeded(term, n) {
  let h = n | 0;
  for (let i = 0; i < term.length; i++) h = (h * 31 + term.charCodeAt(i)) | 0;
  return Math.abs(h) % 100;
}

/**
 * Scan Chinese text and replace dictionary terms with their English words,
 * using forward maximum matching (longest term wins at each position).
 *
 * opts: { minLen = 1, density = 100 }
 *   minLen  minimum term length (in characters) to replace
 *   density percentage of occurrences to actually replace (stable per term+n)
 *
 * Returns { out, stats, counts }:
 *   out    segments [{t:'txt',s} | {t:'rep',zh,en}]
 *   stats  { replaced, totalChars }
 *   counts Map zhTerm -> replacement count
 */
function transform(text, dict, opts = {}) {
  const minLen = opts.minLen || 1;
  const density = opts.density == null ? 100 : opts.density;
  let maxLen = 0;
  for (const k of dict.keys()) if (k.length > maxLen) maxLen = k.length;
  maxLen = Math.min(maxLen, 12);

  const out = [];
  const counts = new Map();
  const occur = new Map();
  let stats = { replaced: 0, totalChars: text.length };
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: 'txt', s: buf }); buf = ''; } };

  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (HAN.test(ch) && maxLen > 0) {
      let best = null;
      const upper = Math.min(maxLen, text.length - i);
      for (let len = upper; len >= minLen; len--) {
        const cand = text.slice(i, i + len);
        if (dict.has(cand)) { best = cand; break; }
      }
      if (best) {
        const n = (occur.get(best) || 0) + 1;
        occur.set(best, n);
        if (density >= 100 || seeded(best, n) < density) {
          flush();
          out.push({ t: 'rep', zh: best, en: dict.get(best) });
          counts.set(best, (counts.get(best) || 0) + 1);
          stats.replaced++;
          i += best.length;
          continue;
        }
        // density skip: fall through and emit as plain text
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return { out, stats, counts };
}

// Plain-text rendering of one replacement segment.
function fmtText(seg, mode) {
  if (mode === 'en') return seg.en;
  if (mode === 'zhen') return seg.zh + '（' + seg.en + '）';
  return seg.en + '（' + seg.zh + '）'; // default: enzh
}

if (typeof module !== 'undefined') {
  module.exports = { parseWordbook, transform, fmtText };
}
