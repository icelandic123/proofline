// Plays storyboard.mjs against a running Proofline and records the screen,
// then lays each scene's narration at the moment that scene started.
//
//   node scripts/video/record.mjs <base-url> <audio-dir> <out.mp4>
//
// <audio-dir> holds one WAV per scene and durations.json (from tts.py).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { scenes } from './storyboard.mjs';

const [base, audioDir, out] = process.argv.slice(2);
if (!base || !audioDir || !out) {
  console.error('usage: record.mjs <base-url> <audio-dir> <out.mp4>');
  process.exit(2);
}
const durations = JSON.parse(readFileSync(join(audioDir, 'durations.json'), 'utf8'));
const W = 1600, H = 900;
const GAP = 0.5; // seconds of quiet after each line

const CURSOR = `
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.id = '__cursor';
    c.style.cssText = 'position:fixed;left:-40px;top:-40px;width:22px;height:22px;border-radius:50%;background:rgba(23,50,77,.25);border:2px solid #17324d;z-index:2147483647;pointer-events:none;transform:translate(-50%,-50%);transition:width .12s,height .12s';
    document.body.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => { c.style.width = c.style.height = '14px'; }, true);
    addEventListener('mouseup', () => { c.style.width = c.style.height = '22px'; }, true);
  });`;

// Let the agent assess every open case first, as the cron sweep would have,
// but leave missing tracking for the Protection scene to fix on camera.
const sweep = await fetch(`${base.replace(/\/$/, '')}/api/sweep`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"autoUploadTracking":false}' }).then((r) => r.json()).catch((e) => ({ error: e.message }));
console.log('sweep', JSON.stringify(sweep).slice(0, 200));

const videoDir = mkdtempSync(join(tmpdir(), 'proofline-video-'));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: videoDir, size: { width: W, height: H } } });
await context.addInitScript(CURSOR);
const page = await context.newPage();
const t0 = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mouse = { x: W / 2, y: H / 2 };

async function center(selector) {
  const el = page.locator(selector).first();
  await el.waitFor({ state: 'visible', timeout: 15000 });
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  return { x: b.x + Math.min(b.width / 2, 160), y: b.y + b.height / 2 };
}

const v = {
  wait: sleep,
  async go(path) {
    await page.goto(`${base.replace(/\/$/, '')}/#${path}`, { waitUntil: 'networkidle' }).catch(() => undefined);
    await sleep(600);
  },
  async hash(path) {
    await page.evaluate((p) => (location.hash = p), path);
    await sleep(500);
  },
  async point(selector) {
    const to = await center(selector);
    await page.mouse.move(to.x, to.y, { steps: 28 });
    mouse = to;
  },
  async click(selector) {
    await v.point(selector);
    await sleep(250);
    await page.mouse.down();
    await sleep(90);
    await page.mouse.up();
    await sleep(400);
  },
  async nav(label) {
    await v.click(`nav >> text=${label}`);
  },
  async scrollTo(selector) {
    await page.locator(selector).first().evaluate((el) => el.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    await sleep(900);
  },
  async scrollTop() {
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(800);
  },
  async typeAtEnd(selector, text) {
    await v.click(selector);
    await page.keyboard.press('Control+End');
    await page.keyboard.type(text, { delay: 38 });
  },
  async overlay(title, sub) {
    await page.evaluate(([title, sub]) => {
      let o = document.getElementById('__overlay');
      if (!o) {
        o = document.createElement('div');
        o.id = '__overlay';
        o.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#17324d;color:#f4efe6;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;font-family:"IBM Plex Sans",sans-serif;opacity:0;transition:opacity .6s';
        document.body.appendChild(o);
      }
      o.innerHTML = `<div style="font-size:64px;font-weight:600;letter-spacing:-.5px">${title}</div><div style="font-size:24px;max-width:900px;text-align:center;line-height:1.4;color:#c9d4e0">${sub}</div>`;
      requestAnimationFrame(() => (o.style.opacity = '1'));
    }, [title, sub]);
    await sleep(700);
  },
  async clearOverlay() {
    await page.evaluate(() => {
      const o = document.getElementById('__overlay');
      if (o) { o.style.opacity = '0'; setTimeout(() => o.remove(), 700); }
    });
    await sleep(700);
  },
};

const timeline = [];
for (const s of scenes) {
  const start = (Date.now() - t0) / 1000;
  const minMs = ((durations[s.id] ?? 3) + GAP) * 1000;
  try {
    await Promise.all([s.run(v), sleep(minMs)]);
  } catch (e) {
    console.error(`scene ${s.id} failed: ${e.message}`);
    await sleep(Math.max(0, minMs - ((Date.now() - t0) / 1000 - start) * 1000));
  }
  timeline.push({ id: s.id, start });
  console.log(`${s.id.padEnd(14)} at ${start.toFixed(1)}s, line ${durations[s.id]}s`);
}
await sleep(1200);
const total = (Date.now() - t0) / 1000;
await page.close();
await context.close();
await browser.close();
const webm = join(videoDir, readdirSync(videoDir).find((f) => f.endsWith('.webm')));

// Lay each narration line at its scene's start; the first scene's load time is trimmed.
const skip = Math.max(0, timeline[0].start + 0.8);
const inputs = ['-ss', skip.toFixed(2), '-i', webm];
const filters = [];
timeline.forEach((t, i) => {
  inputs.push('-i', join(audioDir, `${t.id}.wav`));
  const delay = Math.max(0, Math.round((t.start - skip + 0.3) * 1000));
  filters.push(`[${i + 1}:a]adelay=${delay}|${delay},aresample=48000[a${i}]`);
});
filters.push(`${timeline.map((_, i) => `[a${i}]`).join('')}amix=inputs=${timeline.length}:normalize=0[aout]`);
filters.push(`[0:v]scale=1920:1080:flags=lanczos,fps=30,format=yuv420p[vout]`);
const tmp = out + '.tmp.mp4';
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-t', (total - skip).toFixed(2), '-movflags', '+faststart', tmp], { stdio: 'inherit' });
renameSync(tmp, out);
console.log(`wrote ${out}: ${(total - skip).toFixed(1)}s`);
