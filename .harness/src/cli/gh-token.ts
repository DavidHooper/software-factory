// Prints the agent bot's installation token, minting one when the cached token
// is missing or about to expire. Usage: node gh-token.ts <repo-root>
//
// It always prints something: on failure it prints a token that GitHub
// rejects, so `gh` fails loudly instead of acting as another identity.
import { mkdirSync } from 'node:fs';
import {
  FAILED_TOKEN,
  getCachedToken,
  mintInstallationToken,
  readAppCredentials,
  repositoryFromRemote,
} from '../github-app-token.ts';
import { git, runPaths } from '../run-state.ts';

const root = process.argv[2] ?? process.cwd();

try {
  const credentials = readAppCredentials(process.env);
  if (!credentials) {
    throw new Error(
      'GITHUB_AGENT_APP_ID and GITHUB_AGENT_APP_PRIVATE_KEY(_PATH) are not set',
    );
  }
  const repository =
    process.env.GITHUB_REPOSITORY ??
    repositoryFromRemote(git(root, 'remote', 'get-url', 'origin') ?? '');
  if (!repository) {
    throw new Error('could not tell which GitHub repository this is');
  }

  const paths = runPaths(root);
  mkdirSync(paths.dir, { recursive: true });
  process.stdout.write(
    await getCachedToken(paths.ghToken, () =>
      mintInstallationToken(credentials, repository),
    ),
  );
} catch (error) {
  process.stderr.write(
    `gh-token: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.stdout.write(FAILED_TOKEN);
}
