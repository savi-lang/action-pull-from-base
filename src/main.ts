import * as Core from '@actions/core'
import * as GitHub from '@actions/github'
import * as GitHubUtils from '@actions/github/lib/utils'
import { RequestError } from '@octokit/request-error'

type Octokit = InstanceType<typeof GitHubUtils.GitHub>

const required = { required: true }
const optional = { required: false }

async function run(): Promise<void> {
  try {
    const sourceRepoString = Core.getInput('source-repo', required)
    const targetRepoString = Core.getInput('target-repo', required)

    const input = {
      github: GitHub.getOctokit(Core.getInput('github-token', required)),

      sourceRepoString,
      sourceBranch: Core.getInput('source-branch', required),
      sourceRepo: {
        owner: sourceRepoString.split('/')[0],
        repo: sourceRepoString.split('/')[1],
      },
      targetRepoString,
      targetBranch: Core.getInput('target-branch', required),
      targetRepo: {
        owner: targetRepoString.split('/')[0],
        repo: targetRepoString.split('/')[1],
      },

      pullRequestTitle: Core.getInput('pull-request-title', optional),
      pullRequestBody: Core.getInput('pull-request-body', optional),

      // // TODO: Add dry run capability, for testing?
      // dryRun: Core.getBooleanInput('dry-run', optional),
    }

    const commit = await getLatestSourceCommit(input)
    const branch = await createPullBranchIfNotExists({ ...input, commit })
    const pull = await createPullRequestIfNotExists({ ...input, branch })

    Core.setOutput('pull-request-url', pull.url)
    Core.setOutput('pull-request-number', pull.number)
  } catch (error) {
    if (error instanceof Error) Core.setFailed(error.message)
  }
}

export async function getLatestSourceCommit(input: {
  github: Octokit
  sourceRepoString: string
  sourceRepo: { owner: string; repo: string }
  sourceBranch: string
}): Promise<string> {
  Core.info(
    `Getting latest commit for ${input.sourceRepoString}:${input.sourceBranch}`,
  )
  const {
    data: {
      commit: { sha },
    },
  } = await input.github.rest.repos.getBranch({
    ...input.sourceRepo,
    branch: input.sourceBranch,
  })
  Core.info(`Found commit ${sha}`)

  return sha
}

export async function createPullBranchIfNotExists(input: {
  github: Octokit
  targetRepo: { owner: string; repo: string }
  targetBranch: string
  commit: string
}): Promise<string> {
  Core.info(`Creating a pull request branch for commit ${input.commit}`)

  const branch = `${input.targetBranch}-sync-${input.commit.slice(0, 7)}`

  try {
    Core.info(`Checking for prior existence of a branch named ${branch}`)
    await input.github.rest.repos.getBranch({ ...input.targetRepo, branch })
    Core.info('A branch for this commit already exists')
    // TODO: Deal with the potential race condition between "get" and "create".
  } catch (error) {
    const { status } = error as RequestError
    if (status === 404) {
      Core.info(`Creating the branch`)
      await input.github.rest.git.createRef({
        ...input.targetRepo,
        sha: input.commit,
        ref: `refs/heads/${branch}`,
      })
      Core.info(`Finished creating branch ${branch}`)
    } else {
      throw error instanceof Error ? error : Error(`${error}`)
    }
  }

  return branch
}

export async function createPullRequestIfNotExists(input: {
  github: Octokit
  branch: string
  sourceRepoString: string
  targetRepo: { owner: string; repo: string }
  targetBranch: string
  pullRequestTitle: string
  pullRequestBody: string
}): Promise<{ url: string; number: number }> {
  Core.info(`Creating a pull request for branch ${input.branch}`)

  const pullProps = {
    ...input.targetRepo,
    head: `${input.targetRepo.owner}:${input.branch}`,
    base: input.targetBranch,
  }

  const list = (await input.github.rest.pulls.list(pullProps)).data
  if (list.length > 0) {
    const pull = list[0]
    Core.info(`A pull request for this branch already exists at ${pull.url}`)
    return pull
  }

  const pull = (
    await input.github.rest.pulls.create({
      ...pullProps,
      title:
        input.pullRequestTitle || `Pull latest from ${input.sourceRepoString}`,
      body:
        input.pullRequestTitle ||
        `Automated PR to merge latest ${input.sourceRepoString} into ` +
          `${input.targetBranch}.\n\n` +
          'This PR was created by the [savi-lang/action-pull-from-base](https://github.com/savi-lang/action-pull-from-base) GitHub Action.',
    })
  ).data
  Core.info(`Finished creating pull request #${pull.number} at ${pull.url}`)

  return pull
}

run()
