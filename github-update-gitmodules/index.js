const core = require('@actions/core');
const github = require('@actions/github');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../common/logger');
const branchName = 'bot-update-submodules';

async function run() {
  try {
    logger.info('Starting the submodule update process...');

    // Get the repository and organization from the input
    const repoInput = core.getInput('repo'); // Expecting format org/repo
    logger.debug(`Received repo input: ${repoInput}`);
    const [repoOwner, repoName] = repoInput.split('/');

    if (!repoOwner || !repoName) {
      logger.setFailed('Invalid repo format. Expected format: org/repo');
      return;
    }

    if (repoName.includes('cpk-template')) {
      logger.info(`Skipping as the repo is a template`);
      return;
    }
    const token = core.getInput('token');
    logger.debug('Received GitHub token.');

    // Read the patterns from input
    const patternsInput = core.getInput('patterns');
    logger.debug(`Received patterns input: ${patternsInput}`);
    const patterns = patternsInput.split(',').map(pattern => pattern.trim());

    if (
      patterns.length === 0 ||
      (patterns.length === 1 && patterns[0] === '')
    ) {
      logger.info('Patterns input is empty. No action will be taken.');
      return;
    }

    logger.info(`Patterns: ${patterns.join(', ')}`);
    logger.info(`Repository owner: ${repoOwner} Repository name: ${repoName}`);

    // Clone the target repository using SSH
    const repoUrl = `git@github.com:${repoOwner}/${repoName}.git`;
    logger.info(`Cloning repository: ${repoUrl}`);
    execSync(`git clone ${repoUrl}`);
    process.chdir(repoName);
    logger.info(`Changed working directory to: ${process.cwd()}`);

    // Set the remote URL with the SSH URL
    execSync(`git remote set-url origin ${repoUrl}`);

    // Read the .gitmodules file and count the number of submodules
    const gitmodulesPath = path.join(process.cwd(), '.gitmodules');
    let submoduleCount = 0;
    let existingSubmodules = [];

    if (fs.existsSync(gitmodulesPath)) {
      logger.info(`Reading .gitmodules file from: ${gitmodulesPath}`);
      const gitmodulesContent = fs.readFileSync(gitmodulesPath, 'utf8');
      existingSubmodules = (gitmodulesContent.match(/path = (.+)/g) || []).map(
        line => line.split(' = ')[1].trim(),
      );
      submoduleCount = existingSubmodules.length;
    }

    logger.info(`Number of submodules: ${submoduleCount}`);

    // Calculate the starting page
    const perPage = 100;
    const startPage =
      submoduleCount > 0 ? Math.ceil(submoduleCount / perPage) : 1;
    logger.info(
      `Starting page should be : ${startPage} if we want to save some API calls`,
    );

    // Get the list of repositories in the organization with pagination
    const octokit = github.getOctokit(token);
    let repos = [];
    let page = 1;
    let response;

    do {
      logger.info(`Fetching repositories from GitHub (page ${page})...`);
      response = await octokit.rest.repos.listForOrg({
        org: repoOwner,
        per_page: perPage,
        page: page,
        sort: 'created',
        direction: 'asc',
      });
      repos = repos.concat(response.data); // Concatenate the response data to the repos array
      page++;
    } while (response.data.length === perPage);
    logger.info(
      `Total number of repositories in the organization: ${repos.length}`,
    );

    // Filter repositories that match any of the patterns and start with "cpk"
    const matchingRepos = repos.filter(
      repo =>
        patterns.some(pattern => repo.name.includes(pattern)) &&
        repo.name !== repoName,
    );
    logger.info(`Number of matching repositories: ${matchingRepos.length}`);

    // Delete the branch if it exists
    try {
      logger.info(`Deleting branch ${branchName} if it exists...`);
      execSync(`git push origin --delete ${branchName} || true`);
      // Delete the branch locally, ignoring errors
      execSync(`git branch -D ${branchName} || true`);
    } catch (error) {
      logger.warn(
        `Branch ${branchName} does not exist or could not be deleted.`,
      );
      logger.error(JSON.stringify(error));
    }

    // Create the branch
    logger.info(`Creating new branch: ${branchName}`);
    execSync(`git checkout -b ${branchName}`);

    // Remove submodules that do not match any repository in the fetched list
    existingSubmodules.forEach(submodulePath => {
      const repoName = path.basename(submodulePath);
      if (!matchingRepos.some(repo => repo.name === repoName)) {
        logger.info(`Removing submodule: ${submodulePath}`);
        execSync(`git submodule deinit -f ${submodulePath} || true`);
        execSync(`git rm -f ${submodulePath} || true`);
        execSync(`rm -rf .git/modules/${submodulePath} || true`);
        execSync(`rm -rf ${submodulePath} || true`);
        logger.info(`Removed submodule ${submodulePath}`);
      }
    });

    // Add matching repositories as submodules using SSH URLs
    matchingRepos.forEach(repo => {
      const submodulePath = path.join('modules', repo.name);
      if (!fs.existsSync(submodulePath)) {
        logger.info(`Adding submodule: ${submodulePath}`);
        const submoduleUrl = `git@github.com:${repoOwner}/${repo.name}.git`;
        try {
          execSync(`git submodule add ${submoduleUrl} ${submodulePath}`);
          logger.info(`Added submodule ${submodulePath}`);
        } catch (error) {
          logger.error(`Failed to add submodule ${submodulePath}`);
          logger.error(error.message);
        }
      } else {
        logger.info(`Submodule ${submodulePath} already exists, skipping.`);
      }
    });

    // Commit the changes
    logger.info('Configuring git user...');
    execSync('git config --global user.email "default-user@example.com"');
    execSync('git config --global user.name "Default User"');
    logger.info('Adding changes to git...');
    execSync('git add .');

    try {
      logger.info('Committing changes...');
      execSync(
        `git commit -m "chore/${branchName} Update submodules for matching repositories"`,
      );
      logger.info('Changes committed successfully.');
    } catch (error) {
      logger.warn('No changes to commit');
      logger.error(JSON.stringify(error));
      return;
    }

    const prTitle = `chore/${branchName} Update submodules for matching repositories`;
    const prBody =
      'This PR updates submodules for repositories matching the pattern in META-REPO-PATTERNS.';

    logger.info(`Pushing changes to branch ${branchName}...`);
    execSync(`git push origin ${branchName}`);
    logger.info('Changes pushed successfully.');

    // Create the pull request
    logger.info('Creating pull request...');
    await octokit.rest.pulls.create({
      owner: repoOwner,
      repo: repoName,
      title: prTitle,
      body: prBody,
      head: branchName,
      base: 'main',
    });
    logger.info('Pull request created successfully.');
  } catch (error) {
    logger.error('An error occurred:');
    logger.error(error.message);
    logger.setFailed(error.message);
  }
}

run();
