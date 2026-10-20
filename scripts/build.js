const { mkdir, copyFile } = require('node:fs/promises');
const path = require('node:path');

async function build() {
  const root = path.resolve(__dirname, '..');
  await mkdir(path.join(root, 'public'), { recursive: true });
  await copyFile(path.join(root, 'weekend-escape.html'), path.join(root, 'public/weekend-escape.html'));
  console.log('Built public/weekend-escape.html');
}

build().catch(() => {
  console.error('Unable to build static page.');
  process.exitCode = 1;
});
