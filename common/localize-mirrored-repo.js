const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('./logger.js');

function replaceContentAndCommit(org = null) {
  // Replace all occurrences of opencpk/opencpk-module-ghactions-common with in .github/workflows/*.yml
  logger.info(
    `Replacing opencpk/opencpk-module-ghactions-common in .github/workflows/*.yml in the following org ${org}`,
  );
  const workflowDir = path.join('.github', 'workflows');
  const files = fs.readdirSync(workflowDir);
  files.forEach(file => {
    const filePath = path.join(workflowDir, file);
    if (filePath.endsWith('.yml') || filePath.endsWith('.yaml')) {
      let content = fs.readFileSync(filePath, 'utf8');
      logger.info(
        `Replacing content from opencpk/opencpk-module-ghactions-common to ${org}/mirror-opencpk-module-ghactions-common in ${filePath}`,
      );
      content = content.replace(
        /opencpk\/opencpk-module-ghactions-common/g,
        `${org}/mirror-opencpk-module-ghactions-common`,
      );
      logger.info(
        `Replacing content from opencpk/opencpk-projects-hub to ${org}/cep-projects-hub in ${filePath}`,
      );
      content = content.replace(
        /repo: 'opencpk\/opencpk-projects-hub'/g,
        `repo: '${org}/cep-projects-hub'`,
      );
      fs.writeFileSync(filePath, content);
    }
  });

  // Commit the changes after replacement
  logger.info('Committing changes after replacement');
  execSync('git add .github/workflows');
  try {
    execSync(
      'git commit -m "chores/cleanup: Replace opencpk with internal repo owner in workflow files"',
    );
  } catch (error) {
    if (error.message.includes('nothing to commit')) {
      logger.info('No changes to commit in workflow files. Proceeding...');
    } else {
      logger.info(
        `Committing changes for workflows failed: ${JSON.stringify(error)}`,
      );
    }
  }

  // Replace all occurrences of git@github.com:opencpk with git@github.com:{{internal repo owner}} in .pre-commit-config.yaml
  logger.info('Replacing git@github.com:opencpk in .pre-commit-config.yaml');
  const preCommitConfigPath = '.pre-commit-config.yaml';
  if (fs.existsSync(preCommitConfigPath)) {
    let preCommitContent = fs.readFileSync(preCommitConfigPath, 'utf8');
    preCommitContent = preCommitContent.replace(
      /git@github.com:opencpk\/(opencpk-.*?)\.git/g,
      `git@github.com:${org}/mirror-$1.git`,
    );
    fs.writeFileSync(preCommitConfigPath, preCommitContent);

    // Commit the changes after replacement
    logger.info(
      'chores/cleanup: Committing changes to .pre-commit-config.yaml',
    );
    execSync('git add .pre-commit-config.yaml');
    try {
      logger.info('Committing changes to .pre-commit-config.yaml');
      execSync(
        'git commit -m "chores/update: Replace org opencpk in .pre-commit-config.yaml"',
      );
    } catch (error) {
      logger.warn(`${JSON.stringify(error)}`);
      logger.info(
        'No changes to commit in .pre-commit-config.yaml. Proceeding...',
      );
    }
  } else {
    logger.info(
      '.pre-commit-config.yaml does not exist, skipping replacement.',
    );
  }
}

function replaceCodeownersFile(codeOwners = null) {
  const codeownersPath = path.join('.github', 'CODEOWNERS');
  if (fs.existsSync(codeownersPath)) {
    if (codeOwners) {
      logger.info(
        'Replacing .github/CODEOWNERS file content with provided codeOwners',
      );
      const content = codeOwners.join('\n');
      logger.info(`codeowners content to be added: ${content}`);
      fs.writeFileSync(codeownersPath, content);
    } else {
      logger.info('Emptying .github/CODEOWNERS file');
      fs.writeFileSync(codeownersPath, '');
    }
    logger.info('Committing changes to .github/CODEOWNERS');
    execSync('git add .github/CODEOWNERS');
    try {
      execSync(
        `git commit -m "chores/cleanup: ${codeOwners ? 'Replace' : 'Empty'} .github/CODEOWNERS file"`,
      );
    } catch (error) {
      if (error.message.includes('nothing to commit')) {
        logger.info(
          `No changes to commit in .github/CODEOWNERS. Proceeding...`,
        );
      } else {
        logger.info(
          `Committing changes for codeowners failed: ${JSON.stringify(error)}`,
        );
      }
    }
  } else {
    logger.info('.github/CODEOWNERS does not exist, skipping emptying.');
  }
}

module.exports = { replaceContentAndCommit, replaceCodeownersFile };
