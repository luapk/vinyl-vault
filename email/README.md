# Sending the founder email

Runbook for `founder-resident.html`. Sends via Resend, unsubscribes handled by
`/api/unsubscribe`.

## One-time setup

**1. A domain you own.** You cannot authenticate mail from a `vercel.app`
subdomain. Buy the domain, add it in Resend (Domains > Add), and paste the DNS
records it gives you into your registrar. Wait for all three to go green: SPF,
DKIM, DMARC. Nothing else works until this does.

**2. Add the opt-out column** in the Supabase SQL editor:

```sql
alter table public.profiles
  add column if not exists marketing_opt_out boolean not null default false;
```

**3. Set the Vercel env vars** (Project > Settings > Environment Variables),
then redeploy so `/api/unsubscribe` picks them up:

| Name | Value |
| --- | --- |
| `UNSUBSCRIBE_SECRET` | any long random string, e.g. `openssl rand -base64 32` |
| `SUPABASE_SERVICE_ROLE_KEY` | already set if invites and Stripe work |

**4. Everyone gets the tier the email promises:**

```sql
update public.profiles
set subscription_tier = 'resident',
    subscription_status = 'active',
    scans_this_period = 0
where subscription_tier is distinct from 'resident';
```

## Every send

**Export the list.** Always with the opt-out filter, so people who unsubscribed
from an earlier send never get another one:

```sql
select email, display_name
from public.profiles
where email is not null
  and marketing_opt_out is not true
order by created_at;
```

Download as CSV.

**Set the local env.** `UNSUBSCRIBE_SECRET` must be character-for-character the
same as the one on Vercel, or every unsubscribe link in the send is rejected.

```bash
export RESEND_API_KEY='re_...'
export UNSUBSCRIBE_SECRET='the same value as on Vercel'
export CAMPAIGN_FROM='Vinyl Vault <hello@yourdomain.com>'
export CAMPAIGN_REPLY_TO='paulknott@gmail.com'   # optional
```

**Dry run.** Prints the counts and a sample unsubscribe link. Sends nothing:

```bash
node scripts/send-campaign.mjs --list ~/Downloads/recipients.csv
```

**Send one to yourself.** Check it in Gmail on a phone, click the unsubscribe
link, confirm it lands on the acid confirmation page, then set your own row
back to `marketing_opt_out = false`:

```bash
node scripts/send-campaign.mjs --list ~/Downloads/recipients.csv --test you@yourdomain.com --send
```

**Send for real:**

```bash
node scripts/send-campaign.mjs --list ~/Downloads/recipients.csv --send
```

## Safety behaviour

- Nothing sends without `--send`.
- Every delivered address is appended to `email/.sent-founder-resident.log`
  and skipped on later runs, so a crash or an accidental second run cannot
  double-send. The log holds real addresses and is gitignored.
- A failed batch is not logged as sent, so re-running retries exactly those.
- Duplicate and malformed addresses are dropped before sending.
- Each recipient gets their own signed unsubscribe link. The signature is an
  HMAC of the address, so editing the URL to unsubscribe somebody else fails.
- `List-Unsubscribe` headers are set, so Gmail and Apple Mail show their own
  unsubscribe button. People use that instead of the spam button, which is
  what protects your sending reputation.

## If you change the subject line

It lives in `scripts/send-campaign.mjs` (`SUBJECT`) as well as the comment
block in the HTML. Change both.
