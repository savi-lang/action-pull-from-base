# GitHub Action: Pull from Base

A GitHub Action to automatically create pull requests from a changing upstream base repository.

## Example

```yaml
name: pull-from-base

on:
  workflow_dispatch: {} # allow manual trigger
  schedule:
    - cron: "0 10 * * *" # daily at 10:00 UTC

jobs:
  pull-from-base:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
        with:
          # Note that a Personal Access Token with the "repo" and "workflows"
          # scopes is needed to be able to push a branch that updates workflows.
          # It's recommended to use a bot user account for this purpose.
          # Create the relevant secret in your repo or org and link it here.
          #
          # If you don't need to be able to push workflow updates, you can omit
          # this and use the standard `secrets.GITHUB_TOKEN` used by default.
          token: ${{secrets.BOT_GITHUB_TOKEN}}
      - uses: savi-lang/action-pull-from-base@v0.3.0
        with:
          github-token: ${{secrets.BOT_GITHUB_TOKEN}}
          source-repo: savi-lang/base-standard-library
          source-branch: main
          target-repo: ${{github.repository}}
          target-branch: main
```
