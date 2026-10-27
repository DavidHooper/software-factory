// The inline review threads on a PR that are still waiting for an answer
// (review-threads.ts): nobody has replied, or a human spoke last. Usage:
//   node .harness/src/cli/review-threads.ts <pr> [--all]
// `--all` lists every thread. Each thread's `resolved` comes from the
// agent proxy's `pulls/<n>/ccr/review_threads` route; where that route is
// missing or fails (outside cloud sessions, say), it warns and every thread
// reads `resolved: null`. Prints JSON.
import { execFileSync } from 'node:child_process';
import {
  parseThreadResolutions,
  threadsAwaitingAnswer,
  type ThreadResolution,
  type ReviewComment,
} from '../review-threads.ts';
import { readPages } from '../github-pages.ts';
import { GH_MAX_BUFFER } from './github-facts.ts';

/**
 * The PR's threads as the agent proxy reports their resolved state, or `null`
 * (with a warning) when the route can't be read or answers in another shape.
 */
function readThreadResolutions(number: number): ThreadResolution[] | null {
  try {
    const threads = parseThreadResolutions(
      JSON.parse(
        execFileSync(
          'gh',
          ['api', `repos/{owner}/{repo}/pulls/${number}/ccr/review_threads`],
          {
            encoding: 'utf8',
            maxBuffer: GH_MAX_BUFFER,
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        ),
      ),
    );
    if (threads === null) {
      console.warn(
        "Warning: the review_threads route answered in an unexpected shape, so every thread's resolved is null.",
      );
    }
    return threads;
  } catch (error) {
    console.warn(
      `Warning: couldn't read the review_threads route, so every thread's resolved is null: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

try {
  const [pr, ...flags] = process.argv.slice(2);
  const number = Number(pr);
  if (!(Number.isInteger(number) && number > 0)) {
    throw new Error(
      `Got \`${process.argv.slice(2).join(' ')}\`. Usage: review-threads.ts <pr> [--all]`,
    );
  }
  const comments = readPages(
    `repos/{owner}/{repo}/pulls/${number}/comments?per_page=100`,
    (page) =>
      JSON.parse(
        execFileSync('gh', ['api', page], {
          encoding: 'utf8',
          maxBuffer: GH_MAX_BUFFER,
        }),
      ) as ReviewComment[],
  );
  const threads = threadsAwaitingAnswer(comments, {
    all: flags.includes('--all'),
    resolved: readThreadResolutions(number),
  });
  console.log(JSON.stringify(threads, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
