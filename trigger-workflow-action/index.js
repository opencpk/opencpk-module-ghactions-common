const core = require('@actions/core');
const github = require('@actions/github');
const logger = require('../common/logger');

async function run() {
  try {
    const token = core.getInput('token');
    const repo = core.getInput('repo');
    logger.debug(`Received repo input: ${repo}`);
    const workflow_id = core.getInput('workflow_id');
    logger.debug(`Received workflow_id input: ${workflow_id}`);
    const ref = core.getInput('ref');
    logger.debug(`Received ref input: ${ref}`);
    const inputs = core.getInput('inputs');
    logger.debug(`Received inputs input: ${inputs}`);
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
      core.setFailed('Invalid repo format. Expected format: owner/repo');
      return;
    }
    logger.info(`Repository owner: ${owner} Repository name: ${repoName}`);
    const octokit = github.getOctokit(token);
    logger.info(`Triggering workflow ${workflow_id} on ${repo}`);
    // Log the JSON string before parsing
    logger.info(`JSON string before parsing: ${inputs}`);
    const parsedInputs = JSON.parse(inputs);
    logger.info(`Parsed inputs: ${JSON.stringify(parsedInputs)}`);
    await octokit.rest.actions.createWorkflowDispatch({
      owner,
      repo: repoName,
      workflow_id,
      ref,
      inputs: parsedInputs,
    });
    core.info(`Successfully triggered workflow ${workflow_id} on ${repo}`);
  } catch (error) {
    logger.error(JSON.stringify(error));
    core.setFailed(error.message);
  }
}

run();
