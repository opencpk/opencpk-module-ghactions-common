/* eslint-disable indent */
const core = require('@actions/core');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const github = require('@actions/github');
const logger = require('../common/logger');
async function run() {
  try {
    const filePath = core.getInput('file');
    const fileType = core.getInput('file_type');
    const rootJsonKey = core.getInput('root_json_key');
    let separator = core.getInput('separator') || '/\r?\n/';
    const outputFormat = core.getInput('output_format') || ',';
    const shouldIncludeCallingRepo =
      core.getInput('include_current_repo') === 'true';
    logger.info(
      `include_current_repo is:  ${shouldIncludeCallingRepo} so shouldIncludeCallingRepo is: ${shouldIncludeCallingRepo}`,
    );
    const absolutePath = path.resolve(filePath);
    const { owner, repo } = github.context.repo;

    core.info(`File path: ${filePath}`);
    core.info(`File type: ${fileType}`);
    core.info(`Separator: ${separator}`);
    core.info(`Output format: ${outputFormat}`);
    core.info(`Absolute path: ${absolutePath}`);

    // Check if the separator is a regular expression
    if (separator.startsWith('/') && separator.endsWith('/')) {
      separator = new RegExp(separator.slice(1, -1));
    }

    let properties = [];

    if (fs.existsSync(absolutePath)) {
      core.info(`File exists at path: ${absolutePath}`);
      const fileContent = fs.readFileSync(absolutePath, 'utf8');
      core.info(`File content: ${JSON.stringify(fileContent)}`); // Log the file content as a JSON string to see the exact characters

      switch (fileType) {
        case 'json':
          properties = JSON.parse(fileContent);
          core.info(`Parsed JSON properties: ${JSON.stringify(properties)}`);
          break;
        case 'yml':
        case 'yaml':
          properties = yaml.load(fileContent);
          core.info(`Parsed YAML properties: ${properties}`);
          break;
        case 'file':
        default:
          properties = fileContent
            .split(separator)
            .map(line => line.trim())
            .filter(line => line !== '');
          core.info(`Parsed file properties: ${properties.join(', ')}`);
          break;
      }
    } else {
      core.warning(`File does not exist at path: ${absolutePath}`);
    }

    let propertiesStringified;
    if (fileType === 'json') {
      if (rootJsonKey && rootJsonKey !== '') {
        const jsonContentWithCustomRoot = {};
        jsonContentWithCustomRoot[rootJsonKey] = properties;
        if (shouldIncludeCallingRepo) {
          jsonContentWithCustomRoot['repo'] = `${owner}/${repo}`;
        }

        propertiesStringified = JSON.stringify(
          jsonContentWithCustomRoot,
        ).replace(/"/g, '\\"');
      } else {
        propertiesStringified = JSON.stringify(properties).replace(/"/g, '\\"');
      }

      // Making sure JSON is fully stringified to avoid issues with when parsing back
      propertiesStringified = `"${propertiesStringified}"`;
    } else {
      propertiesStringified = properties.join(outputFormat);
    }

    core.info(`Processed properties: ${propertiesStringified}`);
    core.setOutput('output', propertiesStringified);
    core.info(
      `Successfully read and processed ${fileType} data from ${filePath}`,
    );
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
