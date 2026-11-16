// Token Radar, radar-3 (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores every
// pre-token protocol with the model in lib/model.ts, writes the ranked board to /output/board.json, and
// copies this repository's dashboard/ and screenshots/ to /output. The dashboard's index.html carries
// three tokens — {{COMPARABLES_ROWS}}, {{TOP10_ROWS}}, {{COVERAGE_HTML}} — which this program fills
// from the same computed board, so the page the judge reads and the board the gate checks can never
// disagree. Last, it writes /output/dossier.json, the summary the judge reads, with the vendored
// make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html, dashboard/app.css
// and dashboard/app.js read /output/data.js, which this program writes from the same board.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import type { RadarData } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

const usd = (n: number): string => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${n}`;
};
const mult = (n: number): string => `${n.toFixed(3)}x`;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The comparables table's rows, from the same computed table the model used. */
function comparablesRows(radarData: RadarData): string {
  const onBoard = new Set(radarData.rows.map((r) => r.category ?? 'Other'));
  return radarData.comparables.by_category
    .filter((c) => onBoard.has(c.category))
    .sort((a, b) => b.used - a.used)
    .map(
      (c) =>
        `<tr><td>${esc(c.category)}</td><td class="num">${c.live_n}</td><td class="num">${c.median_residual_log10 === null ? 'none' : mult(10 ** c.median_residual_log10)}</td><td class="num"><b>${mult(c.used)}</b></td></tr>`,
    )
    .join('\n');
}

/** The top ten rows, from the same computed board the gate checks. */
function top10Rows(radarData: RadarData): string {
  return radarData.rows
    .slice(0, 10)
    .map(
      (r) =>
        `<tr><td class="num">${r.rank}</td><td><b>${esc(r.name)}</b><span class="sub">${esc(r.category ?? 'Other')}</span></td><td class="num">${usd(r.tvl_usd)}</td><td class="num"><b>${usd(r.implied_value_usd)}</b></td></tr>`,
    )
    .join('\n');
}

/** The coverage paragraph: what was ranked, what was set aside, and why. */
function coverageHtml(radarData: RadarData): string {
  const c = radarData.coverage;
  const reasons = c.excluded.map((e) => `<li>${esc(e.reason)}: <b>${e.count}</b></li>`).join('\n');
  return (
    `<p>Of the snapshot's <b>${c.protocols_total}</b> protocols, <b>${c.pre_token_total}</b> record no token and ` +
    `<b>${c.live_token_total}</b> already trade. This board ranks <b>${c.board_size}</b> of the pre-token ones: ` +
    `all <b>${c.watchlist_size}</b> watchlist protocols, <b>${c.above_floor_size}</b> rankable protocols above the floor ` +
    `that the watchlist leaves out, and <b>${c.early_size}</b> below it. The other <b>${c.excluded_total}</b> ` +
    `pre-token protocols are set aside, not ranked, for these reasons:</p>\n<ul class="reasons">\n${reasons}\n</ul>`
  );
}

/** Copy one directory's regular files into `to`, filling the page's tokens; skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    if (name === 'index.html') {
      let html = readFileSync(path, 'utf8');
      const filled = html
        .replace('{{COMPARABLES_ROWS}}', comparablesRows(radar))
        .replace('{{TOP10_ROWS}}', top10Rows(radar))
        .replace('{{COVERAGE_HTML}}', coverageHtml(radar));
      if (filled.includes('{{')) {
        process.stderr.write('token radar: dashboard/index.html still holds an unfilled token after the copy\n');
        process.exit(1);
      }
      writeFileSync(join(to, name), filled);
    } else {
      copyFileSync(path, join(to, name));
    }
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.coverage.above_floor_size} above the floor, ${radar.coverage.early_size} early, ${radar.coverage.excluded_total} pre-token set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
