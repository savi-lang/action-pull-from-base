import * as Core from '@actions/core'
import * as GitHub from '@actions/github'
import * as GitHubUtils from '@actions/github/lib/utils'
import { spawnSync } from 'child_process'

type Octokit = InstanceType<typeof GitHubUtils.GitHub>

const required = { required: true }
const optional = { required: false }

async function run(): Promise<void> {
  try {
    const githubToken = Core.getInput('github-token', required)
    const githubUsername = Core.getInput('github-username', optional)
    const sourceRepoString = Core.getInput('source-repo', required)
    const sourceBranch = Core.getInput('source-branch', required)
    const targetRepoString = Core.getInput('target-repo', required)
    const targetBranch = Core.getInput('target-branch', required)
    const pullRequestTitle = Core.getInput('pull-request-title', optional)
    const pullRequestBody = Core.getInput('pull-request-body', optional)
    // // TODO: Add dry run capability, for testing?
    // const dryRun = Core.getBooleanInput('dry-run', optional)

    const input = {
      github: GitHub.getOctokit(githubToken),
      githubActor: githubUsername || GitHub.context.actor,
      githubToken,

      sourceRepoString,
      sourceBranch,
      sourceRepo: {
        owner: sourceRepoString.split('/')[0],
        repo: sourceRepoString.split('/')[1],
      },
      targetRepoString,
      targetBranch,
      targetRepo: {
        owner: targetRepoString.split('/')[0],
        repo: targetRepoString.split('/')[1],
      },

      pullRequestTitle,
      pullRequestBody,
    }

    const commit = await getLatestSourceCommit(input)
    const branch = await createPullBranchLocally({ ...input, commit })
    if (!branch) return
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

// // TODO: Get this function working using octokit.
// //
// // As of today, it doesn't work because GitHub doesn't recognize the
// // history relationship with the upstream base repository.
// //
// // See https://support.github.com/ticket/personal/0/1527459
// export async function createPullBranchIfNotExists(input: {
//   github: Octokit
//   targetRepo: { owner: string; repo: string }
//   targetBranch: string
//   commit: string
// }): Promise<string> {
//   Core.info(`Creating a pull request branch for commit ${input.commit}`)

//   const branch = `${input.targetBranch}-sync-${input.commit.slice(0, 7)}`

//   try {
//     Core.info(`Checking for prior existence of a branch named ${branch}`)
//     await input.github.rest.repos.getBranch({ ...input.targetRepo, branch })
//     Core.info('A branch for this commit already exists')
//     // TODO: Deal with the potential race condition between "get" and "create".
//   } catch (error) {
//     const { status } = error as RequestError
//     if (status === 404) {
//       Core.info(`Creating the branch`)
//       await input.github.rest.git.createRef({
//         ...input.targetRepo,
//         sha: input.commit,
//         ref: `refs/heads/${branch}`,
//       })
//       Core.info(`Finished creating branch ${branch}`)
//     } else {
//       throw error instanceof Error ? error : Error(`${error}`)
//     }
//   }

//   return branch
// }

export async function createPullBranchLocally(input: {
  githubActor: string
  githubToken: string
  sourceRepoString: string
  targetRepoString: string
  targetBranch: string
  commit: string
}): Promise<string | undefined> {
  Core.info(`Locally creating a pull request branch for commit ${input.commit}`)

  const branch = `pull-from-base/${input.commit.slice(0, 7)}`
  const auth = `${input.githubActor}:${input.githubToken}`

  // Create an `source-repo` remote corresponding to the source repository.
  runCommand(
    [
      'git',
      'remote',
      'add',
      'source-repo',
      `https://${auth}@github.com/${input.sourceRepoString}.git`,
    ],
    { sensitive: auth },
  )

  // Create an `target-repo` remote corresponding to the source repository.
  runCommand(
    [
      'git',
      'remote',
      'add',
      'target-repo',
      `https://${auth}@github.com/${input.targetRepoString}.git`,
    ],
    { sensitive: auth },
  )

  // Fetch refs from the source repo, which should include the specified commit.
  runCommand(['git', 'fetch', 'source-repo', input.commit])

  // Check if the target branch already contains the specified commit.
  // If it does, we have nothing left to do here.
  runCommand(['git', 'fetch', 'target-repo', input.targetBranch, '--unshallow'])
  const headAlreadyContainsCommit = runCommandAsBoolean([
    'git',
    'merge-base',
    '--is-ancestor',
    input.commit,
    `refs/remotes/target-repo/${input.targetBranch}`,
  ])
  if (headAlreadyContainsCommit) {
    Core.info(
      `The target branch ${input.targetBranch} already contains this commit`,
    )
    return undefined
  }

  // Checkout the specified commit into a new branch with the specified name.
  runCommand(['git', 'checkout', '-b', branch, input.commit])

  // Push the branch to the target repo.
  runCommand([
    'git',
    'push',
    '-f',
    '-u',
    '--set-upstream',
    'target-repo',
    branch,
  ])

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

// TODO: Consider making this async instead of synchronous, for cleanliness.
function runCommand(
  args: string[],
  options: { sensitive?: string } = {},
): string {
  // Get a version of the command that can be printed,
  // possibly with a redaction of a sensitive string.
  let showCommand = JSON.stringify(args)
  if (options.sensitive)
    showCommand = showCommand.replaceAll(options.sensitive, 'REDACTED')

  // Run the command synchronously (blocking the event loop).
  Core.info(`Running command: ${showCommand}`)
  const process = spawnSync('/usr/bin/env', args)
  const output = String(process.output)

  // If the command failed, throw an error.
  if (process.status !== 0)
    throw new Error(`Command failed: ${showCommand} with output:\n${output}`)

  return output
}

// TODO: Consider making this async instead of synchronous, for cleanliness.
function runCommandAsBoolean(
  args: string[],
  options: { sensitive?: string } = {},
): boolean {
  // Get a version of the command that can be printed,
  // possibly with a redaction of a sensitive string.
  let showCommand = JSON.stringify(args)
  if (options.sensitive)
    showCommand = showCommand.replaceAll(options.sensitive, 'REDACTED')

  // Run the command synchronously (blocking the event loop).
  Core.info(`Running check command: ${showCommand}`)
  const process = spawnSync('/usr/bin/env', args)

  // Check success of the command.
  const success = process.status === 0
  Core.info(`The check returned ${success}`)

  return success
}

run()
