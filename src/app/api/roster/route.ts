/**
 * Roster status, and starting an import.
 *
 * GET returns progress. POST starts a run in the background and returns
 * immediately: constraint 4 forbids iterating the roster inside a request, and
 * a first import is thousands of artists across many pages. The client polls
 * GET rather than holding a request open.
 */

import { NextResponse } from 'next/server';
import { getAccessToken, LOCAL_USER_ID, NotConnectedError, db } from '../../../auth/session.ts';
import { importRoster, rosterStatus, JOB_NAME } from '../../../jobs/roster.ts';
import { loadJob, saveJob } from '../../../db/index.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(rosterStatus(db(), LOCAL_USER_ID));
}

export async function POST() {
  const database = db();

  // Two imports racing would double-write and fight over the cursor. The job
  // row is the lock: single instance, single process, so this is enough.
  const current = loadJob(database, JOB_NAME);
  if (current?.status === 'running') {
    return NextResponse.json(rosterStatus(database, LOCAL_USER_ID));
  }

  // Fail fast on a missing account, so the UI can say so rather than starting
  // a job that dies on its first page.
  try {
    await getAccessToken(database);
  } catch (err) {
    if (err instanceof NotConnectedError) {
      return NextResponse.json({ error: 'not_connected', detail: err.message }, { status: 409 });
    }
    throw err;
  }

  // Deliberately not awaited: the response returns now and the job runs on.
  void importRoster({
    db: database,
    userId: LOCAL_USER_ID,
    getAccessToken: () => getAccessToken(database),
  }).catch((err) => {
    // importRoster handles source failures itself; reaching here means the
    // database or the process is broken, which must not be swallowed silently.
    console.error('[roster] import crashed:', err);
    saveJob(database, JOB_NAME, {
      status: 'failed',
      lastError: err instanceof Error ? err.message : String(err),
    });
  });

  return NextResponse.json(rosterStatus(database, LOCAL_USER_ID));
}
