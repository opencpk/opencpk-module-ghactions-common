const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');

async function run() {
  try {
    const defaultPattern =
      /^(feat|fix|build|breaking|chore|ci|docs|perf|refactor|revert|test)\/([\w-]+)*(:\s+)?(.+)?$/;
    const patternInput = core.getInput('commit-pattern');
    const pattern = patternInput ? new RegExp(patternInput) : defaultPattern;

    let commitHashes = '';
    const options = {
      listeners: {
        stdout: data => {
          commitHashes += data.toString();
        },
      },
    };
    const baseRef = github.context.payload.pull_request.base.ref;

    // Fetch the latest changes from the origin repository
    await exec.exec('git', ['fetch', 'origin']);

    // Get the list of commits that are unique to the current branch compared to the origin base branch
    await exec.exec('git', ['rev-list', `HEAD`, `^origin/${baseRef}`], options);
    const hashesArray = commitHashes.split('\n').filter(Boolean);
    // Get the list of commits from the base repository
    let baseCommitHashes = '';
    await exec.exec('git', ['rev-list', `origin/${baseRef}`], {
      listeners: {
        stdout: data => {
          baseCommitHashes += data.toString();
        },
      },
    });

    const baseHashesArray = baseCommitHashes.split('\n').filter(Boolean);
    const baseHashesSet = new Set(baseHashesArray);

    // Get the list of commits from the main branch in the origin repository
    let mainCommitHashes = '';
    await exec.exec('git', ['rev-list', `origin/main`], {
      listeners: {
        stdout: data => {
          mainCommitHashes += data.toString();
        },
      },
    });

    const mainHashesArray = mainCommitHashes.split('\n').filter(Boolean);
    const mainHashesSet = new Set(mainHashesArray);

    const nonConformingCommits = [];
    let earliestNonConformingIndex = -1;

    for (let i = 0; i < hashesArray.length; i++) {
      if (
        baseHashesSet.has(hashesArray[i]) ||
        mainHashesSet.has(hashesArray[i])
      ) {
        // Ignore commits that exist in the base repository or main branch in origin
        continue;
      }

      let commitMsg = '';
      await exec.exec(
        'git',
        ['log', '--format=%B', '-n', '1', hashesArray[i]],
        {
          listeners: {
            stdout: data => {
              commitMsg += data.toString().trim();
            },
          },
        },
      );

      commitMsg = commitMsg.replace(/\s+/g, ' ');

      if (
        !pattern.test(commitMsg) &&
        !commitMsg.includes('chore(release)') &&
        !commitMsg.startsWith('Merge') &&
        !commitMsg.startsWith('Bump the')
      ) {
        nonConformingCommits.push({ hash: hashesArray[i], message: commitMsg });
        earliestNonConformingIndex = i;
      }
    }

    core.info(
      `Number of commits which do not follow the proper format: ${nonConformingCommits.length}`,
    ); // Log the commit hashes

    if (nonConformingCommits.length > 0) {
      const numberOfCommitsToSquash = earliestNonConformingIndex + 1;
      let errorMessage = `ERROR: Some commits do not follow the required format. The following commits need to be fixed:\n`;
      nonConformingCommits.forEach(({ hash, message }) => {
        errorMessage += `- Commit ${hash} does not follow the required format. Message: "${message}"\n`;
      });
      errorMessage +=
        `Please squash the last ${numberOfCommitsToSquash} commits into a single commit with a proper commit message.\n` +
        `Method 1 (in case during rebase you encounter difficulty please abort and follow method 2):\n` +
        `1. git rebase -i HEAD~${numberOfCommitsToSquash}\n` +
        `2. Your default text editor will open with a list of the last ${numberOfCommitsToSquash} commits, each starting with the word "pick".\n` +
        `   Leave the first commit as "pick" (this is the one you're squashing into).\n` +
        `   Change the word "pick" to "squash" for the next commits.\n` +
        `3. Save and close the editor.\n` +
        `4. After closing the editor, another editor window will open for you to combine the commit messages or write a new one.\n` +
        `   Write your new commit message according to the desired format. For example:\n` +
        `   "feat/test: Combined commit message for feature progress"\n` +
        `5. Save and close the editor. Git will now squash the commits into a single commit with your new message.\n` +
        `6. git push --force\n` +
        `Please ensure your commit messages follow the required pattern.\n` +
        `Method 2 (if you don't want to squash commits):\n` +
        `1. git reset --soft HEAD~${numberOfCommitsToSquash} \n` +
        `2. commit with proper format such as git commit -m "feat/YOUR_JIRA_TICKET: Combined commit message for feature progress"\n` +
        `3. git push --force\n
        `;
      core.setFailed(errorMessage);
    } else {
      core.info('All commit messages follow the required pattern.');
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
