const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
// Keep the alternate page's controls in sync while leaving the original untouched.
const page = source
  .replace('<title>夹读 · 多语混读阅读器</title>', '<title>夹读 · 薄荷粉版</title>')
  .replace('</head>', '<link rel="stylesheet" href="theme.css?v=20261010-1">\n</head>')
  .replace('<h1>夹读<small>多语混读阅读器</small></h1>',
    '<h1>夹读<small>多语混读阅读器</small><span class="theme-label">薄荷粉版</span></h1>')
  .replace(/src="(?!https?:)([^"]+)"/g, 'src="../$1"');
const output = path.join(root, 'mint/index.html');

if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== page) {
    throw new Error('mint/index.html is stale; run node scripts/build-mint.js');
  }
  console.log('Mint page matches the original controls and shared assets.');
} else {
  fs.writeFileSync(output, page);
  console.log('Generated mint/index.html; original index.html was not modified.');
}
