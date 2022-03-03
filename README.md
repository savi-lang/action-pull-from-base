# GitHub Action: Pull from Base

A GitHub Action to automatically create pull requests from a changing upstream base repository.

## Example

```yaml
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
      - uses: savi-lang/action-pull-from-base@v0.2.0
        with:
          # Note that a Personal Access Token with the "repo" and "workflows"
          # scopes is needed to be able to push a branch that updates workflows.
          # It's recommended to use a bot user account for this purpose.
          # Create the relevant secrets in your repo or org and link them here.
          #
          # If you don't need to be able to push workflow updates, you can use
          # the standard `secrets.GITHUB_TOKEN` that comes by default.
          # If you omit the `github-username` input, the action will use the
          # standard `github-actions` user for creating the branch and PR.
          github-token: ${{secrets.BOT_GITHUB_TOKEN}}
          github-username: ${{secrets.BOT_GITHUB_USERNAME}}
          source-repo: savi-lang/base-standard-library
          source-branch: main
          target-repo: ${{github.repository}}
          target-branch: main
```
