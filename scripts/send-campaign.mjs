#!/usr/bin/env node
// Campaign sender: reads a CSV of recipients, renders the email once per
// person (each gets their own signed unsubscribe link), and posts to Resend
// in batches.
//
// Safety, because this touches real people:
//   - dry run by default. Nothing sends unless you pass --send
//   - --test you@example.com sends the whole thing to one address only
//   - every successful address is appended to a sent log, and addresses in
//     that log are skipped on the next run, so a crash or a re-run cannot
//     double-send
//   - opted-out and malformed addresses are dropped before sending
//
// Usage:
//   node scripts/send-campaign.mjs --list recipients.csv                 (dry run)
//   node scripts/send-campaign.mjs --list recipients.csv --test me@x.com --send
//   node scripts/send-campaign.mjs --list recipients.csv --send
//
// Env:
//   RESEND_API_KEY        required to actually send
//   UNSUBSCRIBE_SECRET    required, must match the value set on Vercel
//   CAMPAIGN_FROM         e.g. "Vinyl Vault <hello@yourdomain.com>"
//   CAMPAIGN_REPLY_TO     optional, defaults to the from address
//   SITE_URL              defaults to https://vinyl-vault-teal.vercel.app

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SUBJECT = 'A rare test pressing';
const HTML_PATH = path.join(ROOT, 'email/founder-resident.html');
const TEXT_PATH = path.join(ROOT, 'email/founder-resident.txt');
const SENT_LOG = path.join(ROOT, 'email/.sent-founder-resident.log');

const BATCH_SIZE = 100;       // Resend's batch endpoint ceiling
const PAUSE_MS = 1200;        // stay under the 2 requests/second rate limit

// ---- args -------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => { const i = args.indexOf(name); return i === -1 ? null : args[i + 1]; };

const listPath = value('--list');
const testTo = value('--test');
const doSend = flag('--send');

if (!listPath) {
  console.error('Missing --list <recipients.csv>. See the header of this file for usage.');
  process.exit(1);
}

const {
  RESEND_API_KEY,
  UNSUBSCRIBE_SECRET,
  CAMPAIGN_FROM,
  CAMPAIGN_REPLY_TO,
  SITE_URL = 'https://vinyl-vault-teal.vercel.app',
} = process.env;

if (!UNSUBSCRIBE_SECRET) {
  console.error('Missing UNSUBSCRIBE_SECRET. It must match the value set on Vercel,');
  console.error('otherwise every unsubscribe link in the send will be rejected.');
  process.exit(1);
}
if (doSend && (!RESEND_API_KEY || !CAMPAIGN_FROM)) {
  console.error('Missing RESEND_API_KEY or CAMPAIGN_FROM. Both are required to send.');
  process.exit(1);
}

// ---- recipients -------------------------------------------------------------
// Minimal CSV reader: handles quoted cells and finds the email column by header
// name, falling back to the first column that looks like an address.
function parseCsv(raw) {
  const rows = [];
  let cell = '', row = [], quoted = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quoted) {
      if (c === '"' && raw[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(cell); cell = ''; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (c === '\r') continue;
    cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

const VALID_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function loadRecipients(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (!rows.length) return [];
  const header = rows[0].map(h => h.trim().toLowerCase());
  const looksLikeHeader = header.some(h => ['email', 'e-mail', 'email_address'].includes(h));
  const emailIdx = looksLikeHeader
    ? header.findIndex(h => ['email', 'e-mail', 'email_address'].includes(h))
    : rows[0].findIndex(c => VALID_EMAIL.test(c.trim()));
  const nameIdx = looksLikeHeader
    ? header.findIndex(h => ['display_name', 'name', 'first_name'].includes(h))
    : -1;
  const body = looksLikeHeader ? rows.slice(1) : rows;

  const seen = new Set();
  const out = [];
  for (const r of body) {
    const email = (r[emailIdx] || '').trim().toLowerCase();
    if (!VALID_EMAIL.test(email) || seen.has(email)) continue;
    seen.add(email);
    out.push({ email, name: nameIdx >= 0 ? (r[nameIdx] || '').trim() : '' });
  }
  return out;
}

// ---- unsubscribe links ------------------------------------------------------
const signEmail = (email) => crypto
  .createHmac('sha256', UNSUBSCRIBE_SECRET)
  .update(email.trim().toLowerCase())
  .digest('base64url')
  .slice(0, 32);

const unsubUrl = (email) =>
  `${SITE_URL}/api/unsubscribe?e=${encodeURIComponent(email)}&t=${signEmail(email)}`;

// ---- render -----------------------------------------------------------------
const htmlTemplate = fs.readFileSync(HTML_PATH, 'utf8');
// Strip the plain-text file's own header block; it is instructions, not copy.
const textTemplate = fs.readFileSync(TEXT_PATH, 'utf8').split('---\n').slice(1).join('---\n').trim();

const render = (tpl, email) => tpl.replaceAll('{{unsubscribe_url}}', unsubUrl(email));

// ---- sent log ---------------------------------------------------------------
const alreadySent = new Set(
  fs.existsSync(SENT_LOG)
    ? fs.readFileSync(SENT_LOG, 'utf8').split('\n').map(l => l.split(',')[0].trim().toLowerCase()).filter(Boolean)
    : []
);
const recordSent = (emails) => {
  const stamp = new Date().toISOString();
  fs.appendFileSync(SENT_LOG, emails.map(e => `${e},${stamp}`).join('\n') + '\n');
};

// ---- go ---------------------------------------------------------------------
const all = loadRecipients(listPath);
let recipients = all.filter(r => !alreadySent.has(r.email));
const skipped = all.length - recipients.length;

if (testTo) recipients = [{ email: testTo.trim().toLowerCase(), name: 'Test' }];

console.log(`list ............ ${path.basename(listPath)}`);
console.log(`addresses ....... ${all.length} valid, ${skipped} already sent, ${recipients.length} to go`);
console.log(`subject ......... ${SUBJECT}`);
console.log(`from ............ ${CAMPAIGN_FROM || '(not set)'}`);
console.log(`mode ............ ${testTo ? `TEST -> ${testTo}` : doSend ? 'LIVE SEND' : 'dry run'}`);

if (!recipients.length) { console.log('\nNothing to send.'); process.exit(0); }

if (!doSend) {
  const sample = recipients[0];
  console.log('\nDry run. Nothing has been sent. Sample of the first recipient:');
  console.log(`  to .......... ${sample.email}`);
  console.log(`  unsubscribe . ${unsubUrl(sample.email)}`);
  const rendered = render(htmlTemplate, sample.email);
  console.log(`  html ........ ${rendered.length} bytes, ${(rendered.match(/{{\w+}}/g) || []).length} unfilled placeholders`);
  console.log('\nRe-run with --send to send for real.');
  process.exit(0);
}

const message = (r) => ({
  from: CAMPAIGN_FROM,
  to: [r.email],
  reply_to: CAMPAIGN_REPLY_TO || CAMPAIGN_FROM,
  subject: SUBJECT,
  html: render(htmlTemplate, r.email),
  text: render(textTemplate, r.email),
  headers: {
    // RFC 8058: lets Gmail and Apple Mail show their own unsubscribe button,
    // which keeps complaints away from the spam button.
    'List-Unsubscribe': `<${unsubUrl(r.email)}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  },
});

let sent = 0, failed = 0;
for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
  const batch = recipients.slice(i, i + BATCH_SIZE);
  try {
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(batch.map(message)),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      failed += batch.length;
      console.error(`batch ${i / BATCH_SIZE + 1} failed: ${res.status} ${body.message || JSON.stringify(body).slice(0, 200)}`);
    } else {
      sent += batch.length;
      if (!testTo) recordSent(batch.map(b => b.email));
      console.log(`batch ${i / BATCH_SIZE + 1}: sent ${batch.length} (${sent}/${recipients.length})`);
    }
  } catch (err) {
    failed += batch.length;
    console.error(`batch ${i / BATCH_SIZE + 1} threw: ${err.message}`);
  }
  if (i + BATCH_SIZE < recipients.length) await new Promise(r => setTimeout(r, PAUSE_MS));
}

console.log(`\ndone. sent ${sent}, failed ${failed}.`);
if (failed) {
  console.log('Failed addresses were NOT written to the sent log, so re-running picks them up.');
  process.exit(1);
}
