const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) throw new Error(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function idsFromHtml(html) {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
}

function referencedIds(js) {
  const ids = new Set();
  for (const pattern of [
    /\$\("([^"]+)"\)/g,
    /getElementById\("([^"]+)"\)/g
  ]) {
    for (const match of js.matchAll(pattern)) ids.add(match[1]);
  }
  return ids;
}

const jsFiles = [
  "assets/sponsor-mode-registry.js",
  "assets/sponsor-shared.js",
  "assets/sponsor-control.js",
  "assets/sponsor-modes.js",
  "assets/sponsor-display.js"
];

for (const file of jsFiles) {
  const source = read(file);
  assert(source.length > 0, `${file} is empty`);
  new Function(source);
}

const controlHtml = read("sponsor-control.html");
const displayHtml = read("sponsor-display.html");
const compatibilityHtml = read("sponsor.html");
const controlIds = idsFromHtml(controlHtml);
const displayIds = idsFromHtml(displayHtml);
const compatibilityIds = idsFromHtml(compatibilityHtml);

assert(new Set(controlIds).size === controlIds.length, "sponsor-control.html has duplicate IDs");
assert(new Set(displayIds).size === displayIds.length, "sponsor-display.html has duplicate IDs");
assert(
  new Set(compatibilityIds).size === compatibilityIds.length,
  "sponsor.html has duplicate IDs"
);

for (const id of referencedIds(read("assets/sponsor-control.js"))) {
  assert(controlIds.includes(id), `Control JS references missing #${id}`);
}
for (const id of referencedIds(read("assets/sponsor-display.js"))) {
  assert(displayIds.includes(id), `Display JS references missing #${id}`);
}

for (const html of [controlHtml, displayHtml, compatibilityHtml]) {
  for (const match of html.matchAll(/(?:src|href)="\.\/([^"?#]+)[^"]*"/g)) {
    assert(fs.existsSync(path.join(root, match[1])), `HTML references missing ${match[1]}`);
  }
}

const manifest = JSON.parse(read("manifest.json"));
assert(Array.isArray(manifest.files), "manifest.json files must be an array");
for (const file of manifest.files) {
  assert(fs.existsSync(path.join(root, file)), `manifest.json references missing ${file}`);
}

JSON.parse(read("package.json"));
assert(!controlHtml.includes("mode=clean"), "Dead mode=clean link returned");
assert(
  controlHtml.includes('<iframe id="previewFrame" src="about:blank"'),
  "Preview iframe must boot after canonical state initialization"
);
assert(!read("assets/sponsor-control.js").includes("seedSamplesIfEmpty"), "Legacy auto-seed API returned");
assert(!read("assets/sponsor-shared.js").includes('password: ""'), "OBS password must not be persisted");

const css = read("assets/sponsor.css");
assert((css.match(/{/g) || []).length === (css.match(/}/g) || []).length, "CSS braces are unbalanced");

console.log(`Project checks passed (${checks} assertions).`);
