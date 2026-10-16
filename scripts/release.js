// Publishes the built installer to GitHub Releases using the gh CLI.
// Run after `electron-builder --win nsis --publish never` (see the "release" npm script).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// gh is installed here but is not on PATH, so prefer the absolute path.
const GH_CANDIDATES = [
  'C:\\Program Files\\GitHub CLI\\gh.exe',
  'C:\\Program Files (x86)\\GitHub CLI\\gh.exe'
];
const gh = GH_CANDIDATES.find((p) => fs.existsSync(p)) || 'gh';

const version = require('../package.json').version;
const tag = `v${version}`;
const dist = path.join(__dirname, '..', 'dist');

const setup = path.join(dist, `PasteDL-Setup-${version}.exe`);
const assets = [setup, `${setup}.blockmap`, path.join(dist, 'latest.yml')]
  .filter((p) => fs.existsSync(p));

if (!assets.includes(setup)) {
  console.error(`Build output not found: ${setup}`);
  console.error('Run the build first: npm run dist');
  process.exit(1);
}

const args = [
  'release', 'create', tag,
  ...assets,
  '--title', `PasteDL ${version}`,
  '--notes', `PasteDL ${version}. Installed copies auto-update from this release.`,
  '--target', 'main'
];

console.log(`> gh ${args.join(' ')}`);
execFileSync(gh, args, { stdio: 'inherit' });
console.log(`\nPublished ${tag}: https://github.com/raizexo/paste-dl/releases/tag/${tag}`);
