# Project Name

opencpk-module-ghactions-common

## Description

Git Custom action to create a PR and check the blockage

## Table of Contents

- [Project Name](#project-name)
  - [Description](#description)
  - [Table of Contents](#table-of-contents)
  - [Installation](#installation)
  - [Usage](#usage)
  - [Contributing](#contributing)
  - [License](#license)

## Installation

No installation needed.
If you add a new library always use:

```
npm i --save
```

## Usage

The following is an example of how to use it.

```
name: create-pr-and-check-blockage
on:
  pull_request:
jobs:
  create-pr:
    runs-on: ubuntu-latest
    steps:
      - name: checkout
        uses: actions/checkout@v3
      - name: create PR
        uses: opencpk/opencpk-module-ghactions-common/set-upstream-create-pr@v0.0.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          excluded-repos: "anythingInFuture/repo-to-exclude"
          upstream-file-path: ".github/UPSTREAM"
          new-branch-name: "add-upstream-file-bot"
          bot-commit-message: "Automatically add UPSTREAM file since it does not exists"
  check-blockage:
    needs: create-pr
    runs-on: ubuntu-latest
    steps:
      - name: checkout
        uses: actions/checkout@v3
      - name: Check for PR Blockage
        uses: opencpk/opencpk-module-ghactions-common/set-upstream-check-pr-block@v0.0.1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the [GNU GENERAL PUBLIC LICENSE](./LICENSE).
