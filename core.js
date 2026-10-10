// Core logic for the Chinese-to-target-language mixed reader (pure functions, no DOM).
// Shared by the browser app and node-based tests.

const HAN = /[\u3400-\u9fff]/;
const POS_TAIL = /\s+(?:(?:n|v|vt|vi|adj|adv|prep|pron|conj|num|art|aux|int|interj|phr|phrase|det|modal|m|f|mf|pl|sg|noun|verb|adjective|adverb)(?:\.[a-z]+)*\.?\s*(?:[/&,]\s*)?)+$/i;
const RISKY_SINGLE = new Set('的一是在有把被和与或及为于从向对将着过之其而但又也都很更最各每某上下里外中内前后存取交数目质病');

function cleanTarget(raw) {
  let target = raw.trim().replace(/(?:\s+-|[=:：|｜—–])+$/, '').trim();
  let previous;
  do {
    previous = target;
    target = target
      .replace(/(?:[①-⑳❶-❿]|\d+[.)、]?|[（(【\[])+\s*$/, '')
      .replace(/\s+(?:\[[^\]]+\]|\([^)]*\)|\/[^/]+\/)\s*$/, '')
      .replace(POS_TAIL, '')
      .trim();
  } while (target !== previous);
  return target;
}

function splitEntry(line) {
  const firstSpace = line.search(/\s/);
  let definitionStart = -1;

  if (firstSpace >= 0) {
    for (let index = firstSpace + 1; index < line.length; index++) {
      if (HAN.test(line[index])) { definitionStart = index; break; }
    }
  }

  // Also accept compact delimiter formats such as "hola：你好".
  if (definitionStart < 0) {
    const delimiter = line.match(/[=:：|｜→]\s*(?=[\u3400-\u9fff])/);
    if (delimiter) {
      for (let index = delimiter.index + delimiter[0].length; index < line.length; index++) {
        if (HAN.test(line[index])) { definitionStart = index; break; }
      }
    }
  }

  if (definitionStart < 0) return null;
  const target = cleanTarget(line.slice(0, definitionStart));
  if (!target || target.length > 120 || !/\p{L}/u.test(target)) return null;
  return { target, definition: line.slice(definitionStart) };
}

function detectScript(target) {
  if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(target)) return 'japanese';
  if (/\p{Script=Hangul}/u.test(target)) return 'korean';
  if (/\p{Script=Cyrillic}/u.test(target)) return 'cyrillic';
  if (/\p{Script=Arabic}|\p{Script=Hebrew}/u.test(target)) return 'rtl';
  if (HAN.test(target) && /\p{Script=Latin}/u.test(target)) return 'mixed';
  if (/\p{Script=Latin}/u.test(target)) return 'latin';
  if (HAN.test(target)) return 'han';
  return 'other';
}

function dominantScript(candidates) {
  const counts = new Map();
  for (const candidate of candidates) {
    if (candidate.script === 'other' || candidate.script === 'mixed') continue;
    counts.set(candidate.script, (counts.get(candidate.script) || 0) + 1);
  }
  const preferred = [...counts.entries()].filter(([script]) => script !== 'han');
  const pool = preferred.length ? preferred : [...counts.entries()];
  return pool.sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
}

function scriptMatches(script, dominant) {
  if (dominant === 'japanese' || dominant === 'han') return script === 'japanese' || script === 'han';
  return script === dominant;
}

function plausibleTarget(target, script) {
  if (target.length > 80 || target.split(/\s+/).length > 6) return false;
  if (script === 'latin') return /^[\p{Script=Latin}\p{M}\p{N}'’\-\s]+$/u.test(target);
  if (script === 'cyrillic') return /^[\p{Script=Cyrillic}\p{M}\p{N}'’\-\s]+$/u.test(target);
  return true;
}

/**
 * Parse a wordbook text file.
 * Supported line formats (one entry per line):
 *   apple 苹果
 *   bonjour interj. 你好
 *   こんにちは 你好
 *   사랑 爱
 *   ice cream 冰淇淋
 *   run vi. 跑；奔跑；经营   (senses split by ；; |)
 * The target-language term may use any writing system. Lines with no Chinese
 * definition are skipped.
 *
 * Returns { dict, entries, skipped, filtered, ambiguous, dominantScript }:
 *   dict    Map zhTerm -> targetWord (strict mode omits conflicting mappings)
 *   entries [{target, en, zh}] every extracted sense (`en` is a compatibility alias)
 *   skipped unparseable lines
 *   filtered parseable lines or senses rejected by strict cleaning
 *   ambiguous Chinese terms mapped to more than one target word
 */
function parseWordbook(text, opts = {}) {
  const strict = opts.strict !== false;
  const dict = new Map();
  const entries = [];
  const skipped = [];
  const filtered = [];
  const candidates = [];

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parsed = splitEntry(line);
    if (!parsed) { skipped.push(line); continue; }
    candidates.push({ line, ...parsed, script: detectScript(parsed.target) });
  }

  const dominant = dominantScript(candidates);
  const termTargets = new Map();
  const extracted = [];

  for (const candidate of candidates) {
    if (strict && !scriptMatches(candidate.script, dominant)) {
      filtered.push({ line: candidate.line, reason: '目标语书写系统不一致' });
      continue;
    }
    if (strict && !plausibleTarget(candidate.target, candidate.script)) {
      filtered.push({ line: candidate.line, reason: '不像独立词条或短语' });
      continue;
    }
    const { target, definition } = candidate;
    for (const seg of definition.split(/[；;|｜]/)) {
      const cm = seg.match(/[\u3400-\u9fff]{1,12}/);
      if (!cm) continue;
      const zh = cm[0];
      if (strict && zh.length === 1 && RISKY_SINGLE.has(zh)) {
        filtered.push({ line: candidate.line, reason: `高风险单字释义：${zh}` });
        continue;
      }
      extracted.push({ target, en: target, zh });
      if (!termTargets.has(zh)) termTargets.set(zh, new Set());
      termTargets.get(zh).add(target);
      // "快乐的" style definitions: also index the bare form "快乐".
      const bare = zh.replace(/[的地得]+$/, '');
      if (bare && bare !== zh) {
        extracted.push({ target, en: target, zh: bare });
        if (!termTargets.has(bare)) termTargets.set(bare, new Set());
        termTargets.get(bare).add(target);
      }
    }
  }

  const ambiguous = [];
  for (const [zh, targets] of termTargets) {
    if (strict && targets.size > 1) {
      ambiguous.push({ zh, targets: [...targets] });
      continue;
    }
    dict.set(zh, targets.values().next().value);
  }
  for (const entry of extracted) {
    if (dict.get(entry.zh) === entry.target) entries.push(entry);
  }

  return { dict, entries, skipped, filtered, ambiguous, dominantScript: dominant };
}

// Deterministic per-occurrence pseudo random (0..99), used by density control.
function seeded(term, n) {
  let h = n | 0;
  for (let i = 0; i < term.length; i++) h = (h * 31 + term.charCodeAt(i)) | 0;
  return Math.abs(h) % 100;
}

/**
 * Scan Chinese text and replace dictionary terms with their target-language words,
 * using forward maximum matching (longest term wins at each position).
 *
 * opts: { minLen = 1, density = 100 }
 *   minLen  minimum term length (in characters) to replace
 *   density percentage of occurrences to actually replace (stable per term+n)
 *
 * Returns { out, stats, counts }:
 *   out    segments [{t:'txt',s} | {t:'rep',zh,target,en}]
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
          const target = dict.get(best);
          out.push({ t: 'rep', zh: best, target, en: target });
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
  const target = seg.target == null ? seg.en : seg.target;
  if (mode === 'en') return target;
  if (mode === 'zhen') return seg.zh + '（' + target + '）';
  return target + '（' + seg.zh + '）'; // default: target language + Chinese
}

if (typeof module !== 'undefined') {
  module.exports = { parseWordbook, transform, fmtText };
}
