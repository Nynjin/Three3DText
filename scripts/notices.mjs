/**
 * Regenerate the THIRD-PARTY-NOTICES.md files from the installed dependency
 * tree.
 *
 *   node scripts/notices.mjs
 *
 * Notices are grouped by licence. A licence text two or more packages share is
 * printed once, after them; any other text is printed whole under its package.
 * Writes nothing, and exits 1, if a dependency is not installed.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MODULES = join(ROOT, 'node_modules');

/** Which manifests to describe, and where their notices belong. */
const TARGETS = [
  {
    manifest: 'package.json',
    out: 'THIRD-PARTY-NOTICES.md',
    intro:
      'Direct runtime dependencies of the benchmark application. The label\n'
      + 'renderer is published separately and carries its own notices under\n'
      + '`packages/labels/`.',
    fields: ['dependencies'],
    skip: name => name.startsWith('@itowns/'),
  },
  {
    manifest: 'packages/labels/package.json',
    out: 'packages/labels/THIRD-PARTY-NOTICES.md',
    intro: 'Every dependency of `@itowns/labels`, including its `three` peer.',
    fields: ['dependencies', 'peerDependencies'],
    skip: () => false,
  },
];

const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
const strip = line => line.replace(/^[>\s*]+/, '').trim();
/** An attribution: starts with "Copyright", or names it with a year or a (c) mark. */
const isCopyright = (line) => {
  const s = strip(line);
  return /^copyright\b/i.test(s) || /\bcopyright\b.*(\(c\)|©|\b\d{4}\b)/i.test(s);
};

/** A bare "MIT License" / "The MIT License (MIT)" heading line. */
const TITLE_LINE = /^(the\s+)?[\w\-.\d ]{0,40}licen[cs]e( \([\w\-.\d]+\))?:?$/i;

function licenceFile(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const name = entries.find(e => /^licen[cs]e/i.test(e));
  return name ? readFileSync(join(dir, name), 'utf8').trim() : null;
}

/** Attributions, minus the "above copyright notice" boilerplate. */
function copyrights(text) {
  if (!text) return [];
  return text.split('\n').filter(l => isCopyright(l) && !/permission notice/i.test(l)).map(strip);
}

/**
 * Licence body with attributions and the leading title removed. Packages head
 * their MIT files differently ("MIT License", "The MIT License (MIT)"), which
 * would otherwise defeat grouping on otherwise identical text.
 */
function body(text) {
  if (!text) return '';
  const lines = text.split('\n').filter(l => !isCopyright(l));
  while (lines.length && (!lines[0].trim() || TITLE_LINE.test(lines[0].trim()))) lines.shift();
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Licence texts identifiable well enough to name when metadata will not. */
function detect(text) {
  const t = (text ?? '').toLowerCase();
  if (t.includes('apache license')) return 'Apache-2.0';
  if (t.includes('permission to use, copy, modify, and/or distribute')) return 'ISC';
  if (t.includes('redistribution and use in source and binary forms')) {
    return t.includes('neither the name') ? 'BSD-3-Clause' : 'BSD-2-Clause';
  }
  if (t.includes('permission is hereby granted, free of charge')) return 'MIT';
  return null;
}

/** npm allows free text here ("SEE LICENSE IN LICENSE"); fall back to the text. */
const licenceId = (declared, text) =>
  declared && !/^see licen[cs]e/i.test(declared)
    ? declared
    : detect(text) ?? declared ?? 'Unknown';

const normalize = s => s.replace(/\s+/g, ' ').trim().toLowerCase();
const quote = s => s.split('\n').map(l => (l ? `> ${l}` : '>')).join('\n');

function collect(target) {
  const manifest = readJSON(join(ROOT, target.manifest));
  const names = new Set();
  for (const field of target.fields) {
    for (const name of Object.keys(manifest[field] ?? {})) {
      if (!target.skip(name)) names.add(name);
    }
  }

  return [...names].sort().map((name) => {
    const dir = join(MODULES, name);
    let pkg = {};
    try {
      pkg = readJSON(join(dir, 'package.json'));
    } catch { /* not installed; reported by the caller */ }
    const text = licenceFile(dir);
    const declared = pkg.license ?? pkg.licence ?? null;
    return {
      name,
      version: pkg.version ?? null,
      licence: licenceId(declared, text),
      declared,
      author: typeof pkg.author === 'string' ? pkg.author : pkg.author?.name ?? null,
      copyrights: copyrights(text),
      body: body(text),
      hasFile: Boolean(text),
    };
  });
}

function render(target, packages) {
  const out = ['# Third-party notices', '', target.intro, ''];

  const byLicence = new Map();
  for (const p of packages) {
    if (!byLicence.has(p.licence)) byLicence.set(p.licence, []);
    byLicence.get(p.licence).push(p);
  }

  for (const [id, group] of [...byLicence].sort(([a], [b]) => a.localeCompare(b))) {
    out.push(`## ${id}`, '');

    // Print the text most of the group shares once, if two or more share it.
    const texts = new Map();
    for (const p of group) {
      if (!p.body) continue;
      const key = normalize(p.body);
      if (!texts.has(key)) texts.set(key, { body: p.body, count: 0 });
      texts.get(key).count += 1;
    }
    let sharedKey = null;
    for (const [key, entry] of texts) {
      if (sharedKey === null || entry.count > texts.get(sharedKey).count) sharedKey = key;
    }
    if (sharedKey !== null && texts.get(sharedKey).count < 2) sharedKey = null;
    const shared = sharedKey === null ? null : texts.get(sharedKey).body;

    for (const p of group) {
      out.push(`### ${p.name}${p.version ? ` ${p.version}` : ''}`, '');
      const notes = [];
      if (p.copyrights.length) notes.push(p.copyrights.join('\n\n'));
      else notes.push(p.author ? `Copyright (c) ${p.author}` : 'No copyright notice distributed');
      if (!p.hasFile) notes.push(`The package declares ${p.declared ?? 'no licence'} in its metadata and ships no licence text.`);
      if (p.declared && p.declared !== p.licence) notes.push(`Metadata says "${p.declared}"; identified as ${p.licence} from the licence text.`);
      out.push(quote(notes.join('\n\n')), '');
      if (p.body && normalize(p.body) !== sharedKey) out.push(quote(p.body), '');
    }

    if (shared) out.push(`#### ${id} licence text`, '', quote(shared), '');
  }

  out.push('---', '', 'Generated by `node scripts/notices.mjs` from the installed dependency tree.');
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

const collected = TARGETS.map(target => ({ target, packages: collect(target) }));

let missing = 0;
for (const { packages } of collected) {
  for (const p of packages) {
    if (!p.version) {
      console.warn(`  ! ${p.name} is not installed; run npm install`);
      missing += 1;
    } else if (!p.hasFile) {
      console.warn(`  ~ ${p.name} ships no licence file; using package metadata`);
    }
  }
}
if (missing) process.exit(1);

for (const { target, packages } of collected) {
  writeFileSync(join(ROOT, target.out), render(target, packages));
  console.log(`  wrote ${target.out} (${packages.length} packages)`);
}
