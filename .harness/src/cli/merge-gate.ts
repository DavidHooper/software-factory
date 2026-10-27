// The harness supervisor's check of the merge gate before it merges. Usage:
//   node .harness/src/cli/merge-gate.ts <n> <merge.json>
// Whether PR <n>'s head may merge (`supervisorMerge`: an open agent PR that
// passes the merge gate), on facts read now with the dispatcher's own reads:
// prints its head and the gate's note as JSON. When it passes, writes the
// merge call's body to <merge.json>, for
// `github-write.ts PUT repos/{owner}/{repo}/pulls/<n>/merge --input <merge.json>`.
// It deletes <merge.json> first, so when the gate fails or can't be read, an
// earlier pass's body isn't left to send under the merge allow rule.
import { rmSync, writeFileSync } from 'node:fs';
import { mergeBody, supervisorMerge } from '../dispatch.ts';
import { api, githubFacts } from './github-facts.ts';

try {
  const [pr, out, ...rest] = process.argv.slice(2);
  const number = Number(pr);
  if (!(Number.isInteger(number) && number > 0) || !out || rest.length > 0) {
    throw new Error(
      `Got \`${process.argv.slice(2).join(' ')}\`. Usage: merge-gate.ts <n> <merge.json>`,
    );
  }
  rmSync(out, { force: true });
  const { full_name: repo, default_branch: branch } = api<{
    full_name: string;
    default_branch: string;
  }>('repos/{owner}/{repo}');
  const pull = githubFacts(repo, branch).pullFacts(number);
  const decision = supervisorMerge(pull);
  if (decision.merge) {
    writeFileSync(
      out,
      `${JSON.stringify(mergeBody(decision.merge), null, 2)}\n`,
    );
  }
  console.log(
    JSON.stringify(
      {
        passes: decision.merge !== undefined,
        head: pull.headSha,
        note: decision.note,
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
