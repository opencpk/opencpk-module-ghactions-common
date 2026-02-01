const logger = require('../common/logger');
const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const {
  replaceContentAndCommit,
  replaceCodeownersFile,
} = require('../common/localize-mirrored-repo.js');

async function run() {
  try {
    const mergeBranch = 'chore/bot-sync-with-mirror';
    core.info('Starting the sync process...');
    const token = core.getInput('github_token');
    logger.debug(`Received token: ${token}`);
    const octokit = github.getOctokit(token);
    // Get the repository and organization from the input
    const repoInput = core.getInput('repo'); // Expecting format org/repo
    logger.debug(`Received repo input: ${repoInput}`);
    const [repoOwner, repoName] = repoInput.split('/');
    logger.debug(`Repo owner: ${repoOwner}, Repo name: ${repoName}`);
    const upstreamUrl = core.getInput('upstreamUrl');
    core.info(`Reading UPSTREAM file from: ${upstreamUrl}`);
    if (!repoOwner || !repoName) {
      logger.setFailed('Invalid repo format. Expected format: org/repo');
      return;
    }

    core.info(`Upstream URL: ${upstreamUrl}`);
    const branch = core.getInput('branch') || 'main';

    // Clone the target repository using SSH
    await exec.exec('git', [
      'clone',
      `git@github.com:${repoOwner}/${repoName}.git`,
    ]);
    process.chdir(repoName);

    // Configure git
    await exec.exec('git', [
      'config',
      '--global',
      'user.name',
      'github-actions',
    ]);
    await exec.exec('git', [
      'config',
      '--global',
      'user.email',
      'github-actions@github.com',
    ]);

    // Add upstream remote
    await exec.exec('git', ['remote', 'add', 'upstream', upstreamUrl]);
    await exec.exec('git', ['fetch', 'upstream']);
    logger.debug('Upstream remote added successfully.');
    // Delete the existing bot-sync-with-mirror branch if it exists locally
    try {
      await exec.exec('git', ['branch', '-D', mergeBranch]);
    } catch (error) {
      core.info(
        'Local branch bot-sync-with-mirror does not exist, skipping deletion.',
      );
    }
    logger.debug('Local branch cleanup complete.');
    // Delete the existing bot-sync-with-mirror branch if it exists remotely
    try {
      await exec.exec('git', ['push', 'origin', '--delete', mergeBranch]);
    } catch (error) {
      core.info(
        `Remote branch ${mergeBranch} does not exist, skipping deletion.`,
      );
    }
    logger.debug('Branch cleanup complete.');
    // Checkout a new branch for the merge
    await exec.exec('git', ['checkout', '-b', mergeBranch]);
    logger.debug(`Checked out new branch: ${mergeBranch}`);
    // Merge upstream/main into the current branch, always accepting upstream changes in case of conflicts
    await exec.exec('git', [
      'merge',
      '--strategy-option=theirs',
      '--allow-unrelated-histories',
      `upstream/${branch}`,
    ]);
    logger.debug('Merged upstream/main into the current branch.');

    // Restore .github/CODEOWNERS from the current branch
    await exec.exec('git', [
      'checkout',
      'HEAD@{1}',
      '--',
      '.github/CODEOWNERS',
    ]);
    logger.debug('Restored .github/CODEOWNERS from the current branch.');

    try {
      logger.info('Restoring .github/CODEOWNERS');
      execSync('git commit -m "chores/update: Restoring .github/CODEOWNERS"');
    } catch (error) {
      logger.warn(`${JSON.stringify(error)}`);
      logger.info('No changes to commit for .github/CODEOWNERS. Proceeding...');
    }

    replaceContentAndCommit(repoOwner);
    logger.debug('Replaced content and committed changes.');
    // Check for changes
    let diffOutput = '';
    const options = {};
    options.listeners = {
      stdout: data => {
        diffOutput += data.toString();
      },
    };
    logger.debug('Checking for changes...');
    await exec.exec('git', ['diff', 'HEAD~1', '--name-only'], options);
    logger.debug('Changes checked successfully.');
    core.info(`Diff output: ${diffOutput}`);

    if (!diffOutput.trim()) {
      core.info(
        'No changes detected after merge. Exiting without creating a pull request.',
      );
      return;
    }
    logger.debug('Changes detected. Staging changes...');
    // Stage changes
    await exec.exec('git', ['add', '.']);
    logger.debug('Changes staged successfully.');
    // Check for staged changes
    let statusOutput = '';
    const statusOptions = {
      listeners: {
        stdout: data => {
          statusOutput += data.toString();
        },
      },
    };
    await exec.exec('git', ['status', '--porcelain'], statusOptions);

    if (!statusOutput.trim()) {
      core.info('No changes to commit. Proceeding...');
    } else {
      logger.debug('Changes detected. Committing changes...');
      // Commit changes
      try {
        let commitOutput = '';
        const commitOptions = {
          listeners: {
            stdout: data => {
              commitOutput += data.toString();
            },
          },
        };
        logger.debug('Committing changes...');
        await exec.exec(
          'git',
          [
            'commit',
            '-m',
            'chores/update: Replace opencpk with internal repo owner in .pre-commit-config.yaml',
          ],
          commitOptions,
        );
        logger.debug(`Commit output: ${commitOutput}`);
        if (commitOutput.includes('nothing to commit')) {
          core.info('No changes to commit. Proceeding...');
        } else {
          core.info('Changes committed successfully.');
        }
      } catch (error) {
        core.error(`Failed to commit changes: ${error.message}`);
        return;
      }
    }

    // Set remote URL to use SSH
    const remoteUrl = `git@github.com:${repoOwner}/${repoName}.git`;
    core.info(`Setting remote URL to: ${remoteUrl}`);
    await exec.exec('git', ['remote', 'set-url', 'origin', remoteUrl]);

    // Push the merge branch to origin
    try {
      await exec.exec('git', ['push', '--force', 'origin', mergeBranch]);
    } catch (error) {
      core.error(`Failed to push to origin: ${error.message}`);
      if (
        error.message.includes(
          'refusing to allow a GitHub App to create or update workflow',
        )
      ) {
        core.setFailed(
          'The GitHub token does not have the required `workflows` permission to push changes to `.github/workflows`.',
        );
        return;
      } else {
        throw error;
      }
    }

    // Create a pull request
    await octokit.pulls.create({
      owner: repoOwner,
      repo: repoName,
      title: `${mergeBranch}: Sync with mirror repository`,
      head: mergeBranch,
      base: branch,
      body: 'This PR merges changes from upstream/main and resolves conflicts by accepting upstream changes.',
    });

    core.info('Pull request created successfully');
  } catch (e) {
    if (e.message.includes('No commits between')) {
      core.info('No changes to commit. Proceeding...');
    } else {
      core.setFailed(`Action failed with error: ${e.message}`);
    }
  }
}

run();
