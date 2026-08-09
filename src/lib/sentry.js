// Error tracking via Sentry. Fully inert unless VITE_SENTRY_DSN is set, so
// dev and any deployment without the env var behave exactly as before.
//
// Setup: create a free project at sentry.io (platform: React), copy its DSN
// into the Vercel env var VITE_SENTRY_DSN, redeploy. Errors from testers then
// arrive with stack trace, browser, and breadcrumbs -- no more diagnosing
// from screenshots.
//
// Privacy: no PII is sent. Users are identified only by their Supabase user
// id so repeat crashes from one tester can be grouped.
import * as Sentry from '@sentry/react';

const dsn = import.meta.env.VITE_SENTRY_DSN;

export const sentryEnabled = !!dsn;

export function initSentry() {
  if (!dsn) return;
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    // Keep the free-tier quota comfortable: sample traces lightly; errors
    // themselves are always sent.
    tracesSampleRate: 0.1,
    ignoreErrors: [
      // Expected offline noise, not bugs.
      'Failed to fetch', 'NetworkError', 'Load failed',
    ],
  });
}

export function setSentryUser(user) {
  if (!dsn) return;
  Sentry.setUser(user?.id ? { id: user.id } : null);
}

export function reportError(error, extra) {
  if (!dsn) return;
  Sentry.captureException(error, extra ? { extra } : undefined);
}
