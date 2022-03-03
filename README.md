# GitHub Action: Pull from Base

A GitHub Action to automatically create pull requests from a changing upstream base repository.

## Example

```
name: pull-from-base

on:
  workflow_dispatch: {} # allow manual trigger
  schedule:
    - cron: "0 8 * * *" # daily/nightly at 08:00 UTC

jobs:
  pull-from-base:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: savi-lang/action-pull-from-base@v0.1.10
        with:
          github-token: ${{secrets.GITHUB_TOKEN}}
          source-repo: savi-lang/base-standard-library
          source-branch: main
          target-repo: ${{github.repository}}
          target-branch: main
```
