const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../common/logger.js');
const { setGitActionAccess } = require('../common/git-operations.js');
const {
  replaceContentAndCommit,
  replaceCodeownersFile,
} = require('../common/localize-mirrored-repo.js');
const prefix = 'mirror';

async function processRepo(
  publicRepoUrl,
  org,
  token,
  newRepoName = null,
  codeOwner = null,
) {
  logger.info(
    `Processing repository ${publicRepoUrl} in ${org} with request for newRepoName ${newRepoName}...`,
  );
  const octokit = github.getOctokit(token);
  let repoName = newRepoName
    ? newRepoName
    : publicRepoUrl.split('/').pop().replace('.git', '');
  repoName = `${prefix}-${repoName}`;
  // Check if the private repository already exists
  try {
    await octokit.repos.get({
      owner: org,
      repo: repoName,
    });
    logger.info(`Repository ${org}/${repoName} already exists.`);
    return;
  } catch (error) {
    if (error.status !== 404) {
      throw error;
    }
  }
  core.info(`Creating private repository ${repoName} in ${org}...`);
  // Create a private repository in the organization
  const { data: privateRepo } = await octokit.repos.createInOrg({
    org,
    name: repoName,
    visibility: 'internal',
  });

  // Clone the public repository
  execSync(`git clone ${publicRepoUrl} public-repo`);
  process.chdir('public-repo');
  logger.info('Configured Git user');
  // Configure Git user
  execSync(
    'git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
  );
  execSync('git config user.name "github-actions[bot]"');

  // Add UPSTREAM file
  logger.info('Adding UPSTREAM file');
  const upstreamContent = `git@github.com:${
    publicRepoUrl.split('https://github.com/')[1]
  }.git`;
  const upstreamFilePath = path.join('.github', 'UPSTREAM');
  fs.mkdirSync(path.dirname(upstreamFilePath), { recursive: true });
  fs.writeFileSync(upstreamFilePath, upstreamContent);

  // Commit the UPSTREAM file
  logger.info('Committing UPSTREAM file');
  execSync('git add .github/UPSTREAM');
  execSync('git commit -m "chores/add-upstream: Add UPSTREAM file"');

  // Add the GitHub Actions workflow file
  logger.info('Adding GitHub Actions workflow file');

  const workflowContent = `---
name: github-call-sync-with-mirror
on:
  push:
    branches:
      - main
  schedule:
    - cron: "0 0 * * *"
  workflow_dispatch:
jobs:
  github-call-sync-with-mirror:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Get Token
        id: get_workflow_token
        uses: peter-murray/workflow-application-token-action@v3
        with:
          application_id: \${{ secrets.GH_APP_REPO_ACTION_RW_APPLICATION_ID }}
          application_private_key: \${{ secrets.GH_APP_REPO_ACTION_RW_PRIVATE_KEY }}
          revoke_token: true

      - name: Read patterns from file
        id: read_patterns
        uses: opencpk/opencpk-module-ghactions-common/read-and-stringify-json-action@main
        with:
          file: '.github/UPSTREAM'
          file_type: 'file'
          separator: '/\\r?\\n/'
          output_format: ','

      - name: Log upstream
        run: |
          echo "Patterns: \${{ steps.read_patterns.outputs.output }}"

      - name: Trigger reusable workflow via API
        uses: opencpk/opencpk-module-ghactions-common/trigger-workflow-action@main
        with:
          token: \${{ steps.get_workflow_token.outputs.token }}
          repo: 'tucowsinc/cep-projects-hub'
          workflow_id: 'github-sync-with-mirror.yml'
          ref: 'main'
          inputs: '{"repo":"\${{ github.repository }}", "upstreamUrl":"\${{ steps.read_patterns.outputs.output }}"}'

    `;
  const workflowFileName = 'github-call-sync-with-mirror.yml';
  const workflowFilePath = path.join('.github', 'workflows', workflowFileName);
  fs.mkdirSync(path.dirname(workflowFilePath), { recursive: true });
  fs.writeFileSync(workflowFilePath, workflowContent);

  // Commit the workflow file
  logger.info('Committing workflow file');
  execSync(`git add .github/workflows/${workflowFileName}`);
  execSync(
    'git commit -m "chores/add-workflows: Add sync-with-mirror workflow"',
  );

  logger.info(
    'Replacing content in workflow files and .pre-commit-config.yaml',
  );
  replaceContentAndCommit(org);
  logger.info('Replacing CODEOWNERS file');
  replaceCodeownersFile(codeOwner);
  // Set the remote URL with the token for authentication
  logger.info('Setting remote URL with token for authentication');
  const remoteUrl = `https://x-access-token:${token}@github.com/${org}/${repoName}.git`;
  execSync(`git remote set-url origin ${remoteUrl}`);
  execSync('git push --all');
  execSync('git push --tags');

  core.setOutput('private_repo_url', privateRepo.html_url);
  const response = await setGitActionAccess(
    token,
    org,
    repoName,
    'organization',
  );
  core.info(`Response: ${response}`);
}

async function run() {
  try {
    const token = core.getInput('github_token');
    const gitRepos = core.getInput('github_repos');
    const repos = JSON.parse(gitRepos);
    const errors = [];
    for (const repo of repos) {
      const {
        repo: publicRepoUrl,
        org,
        newRepoName = null,
        codeOwner = null,
      } = repo;
      try {
        await processRepo(publicRepoUrl, org, token, newRepoName, codeOwner);
      } catch (e) {
        errors.push({ publicRepoUrl, error: `${JSON.stringify(e)}` });
        logger.error(`Error processing ${publicRepoUrl}: ${JSON.stringify(e)}`);
      }
    }
    if (errors.length > 0) {
      logger.setFailed(
        `Errors processing ${errors.length} repositories: ${JSON.stringify(errors)}`,
      );
    }
  } catch (error) {
    logger.error(`Error: ${JSON.stringify(error)}`);
    logger.setFailed(error.message);
  }
}
run();
