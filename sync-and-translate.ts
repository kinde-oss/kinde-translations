import {
  getJsonFileDifferencesBetweenCommits,
  applyJsonDifferencesToFile,
} from "./json-diff-checker"
const { glob } = require("glob")
const path = require("path")
const fs = require("fs")
const { Octokit } = require("@octokit/rest")
require("dotenv").config()

let inDebug = process.env.DEBUG === 'true' || process.env.NODE_ENV === 'development'

function toRepoPath(filePath: string): string {
  return filePath.replace(/^\.\//, "").replace(/\\/g, "/")
}

async function commitTranslatedFilesViaApi({
  octokit,
  owner,
  repo,
  branch,
  files,
  log,
}: {
  octokit: any
  owner: string
  repo: string
  branch: string
  files: string[]
  log: (message: string) => void
}): Promise<void> {
  const ref = `heads/${branch}`
  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref,
  })
  const parentSha = refData.object.sha
  const { data: parentCommit } = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: parentSha,
  })

  const treeItems = files.map((filePath) => {
    const content = fs.readFileSync(filePath, "utf8")
    return {
      path: toRepoPath(filePath),
      mode: "100644" as const,
      type: "blob" as const,
      content,
    }
  })

  const { data: newTree } = await octokit.rest.git.createTree({
    owner,
    repo,
    base_tree: parentCommit.tree.sha,
    tree: treeItems,
  })

  // Omit author, committer, and signature so GitHub verifies this as
  // github-actions[bot]. Local git commit + push is unsigned and rejected.
  const { data: newCommit } = await octokit.rest.git.createCommit({
    owner,
    repo,
    message: "chore: Auto-translate JSON files",
    tree: newTree.sha,
    parents: [parentSha],
  })

  await octokit.rest.git.updateRef({
    owner,
    repo,
    ref,
    sha: newCommit.sha,
  })

  log(`Created verified commit ${newCommit.sha} on ${branch}`)
}

async function run() {
  let logs: string[] = []
  let filesModified: string[] = []
  let filesErrored: string[] = []
  let targetFiles: string[] = []
  let octokit: any = null
  let repoOwner: string | undefined
  let repoName: string | undefined
  let issueNumber: string | undefined
  let hadError = false

  const log = (message: string) => {
    process.stdout.write(message + "\n")
    logs.push(message)
  }

  try {
    const sourceFilePath = process.env.SOURCE_JSON_FILE_PATH
    const targetJsonGlobPattern = process.env.TARGET_JSON_GLOB_PATTERN
    const baseSha = process.env.BASE_COMMIT_SHA
    const headSha = process.env.HEAD_COMMIT_SHA
    const gitBranchName = process.env.GIT_BRANCH_NAME
    const deeplApiKey = process.env.DEEPL_API_KEY
    const commitChanges = process.env.COMMIT_CHANGES === "true"
    const isDeepLFreeApi = process.env.IS_DEEPL_FREE_API === "true"
    const deeplNonSplittingTagsStr = process.env.DEEPL_NON_SPLITTING_TAGS
    const deeplNonSplittingTags = deeplNonSplittingTagsStr
      ? deeplNonSplittingTagsStr.split(",")
      : undefined

    const githubToken = process.env.GITHUB_TOKEN
    octokit = githubToken ? new Octokit({ auth: githubToken }) : null
    repoOwner = process.env.GITHUB_REPOSITORY_OWNER
    repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
    issueNumber = process.env.GITHUB_ISSUE_NUMBER

    if (inDebug) {
      log("Source File Path: " + sourceFilePath)
      log("Target JSON Glob Pattern: " + targetJsonGlobPattern)
      log("Base Commit SHA: " + baseSha)
      log("Head Commit SHA: " + headSha)
      log("Git Branch Name: " + gitBranchName)
      log("DeepL API Key: " + (deeplApiKey ? 'Set' : 'unset'))
    }

    if (
      !sourceFilePath ||
      !targetJsonGlobPattern ||
      !baseSha ||
      !headSha ||
      !deeplApiKey ||
      (commitChanges && !gitBranchName)
    ) {
      throw new Error(
        "Missing required environment variables. Ensure SOURCE_JSON_FILE_PATH, TARGET_JSON_GLOB_PATTERN, BASE_COMMIT_SHA, HEAD_COMMIT_SHA, and DEEPL_API_KEY are set."
      )
    }

    if (commitChanges && (!octokit || !repoOwner || !repoName || !gitBranchName)) {
      throw new Error(
        "COMMIT_CHANGES requires GITHUB_TOKEN, GITHUB_REPOSITORY_OWNER, GITHUB_REPOSITORY, and GIT_BRANCH_NAME."
      )
    }

    log("Calculating differences...")
    const differences = await getJsonFileDifferencesBetweenCommits(
      sourceFilePath,
      baseSha,
      headSha
    )
    log("Calculated Differences: " + JSON.stringify(differences, null, 2))

    if (
      differences.added.length === 0 &&
      differences.updated.length === 0 &&
      differences.deleted.length === 0
    ) {
      log("No English translation diffs to apply.")
      return
    }

    log(`Searching for target files with pattern: ${targetJsonGlobPattern}`)
    targetFiles = await glob(targetJsonGlobPattern)

    const excludedLanguageCodes = [
      "sr",
      "nl-be",
      "no",
      "ms",
      "mn",
      "ht",
      "hr",
      "fa",
      "en-au",
      "ar-001",
      "fil"
    ]

    targetFiles = targetFiles.filter((a: string) => {
      return a != "en/auth.json" && !excludedLanguageCodes.includes(a.split("/")[0].toLowerCase())
    })

    if (targetFiles.length === 0) {
      log("No target JSON files found matching the glob pattern and exclusion. No files will be updated.")
      return
    }

    log("Found target files: " + targetFiles.map((file) => file.split("/")[0]).join(", "))

    for (const targetFilePath of targetFiles) {
      const dirName = path.basename(path.dirname(targetFilePath))
      let targetLangCode = dirName.toUpperCase()

      switch (targetLangCode) {
        case "PT":
          targetLangCode = "PT-PT"
          break
      }

      log(`➡️ Updating ${targetLangCode} ...`)
      try {
        const before = fs.readFileSync(targetFilePath, "utf8")
        await applyJsonDifferencesToFile(
          targetFilePath,
          differences,
          targetLangCode,
          deeplApiKey,
          isDeepLFreeApi,
          deeplNonSplittingTags
        )
        const after = fs.readFileSync(targetFilePath, "utf8")
        if (before !== after) {
          filesModified.push(targetFilePath)
        }
      } catch (error) {
        const errorMsg = `❌ \n\tError processing ${targetFilePath}: ${(error as Error).message}`
        console.error(errorMsg)
        log(errorMsg)
        filesErrored.push(targetFilePath)
      }
    }

    log("All target files synchronization and translation attempt complete!")

    if (commitChanges && filesModified.length > 0) {
      log("Creating verified commit via GitHub API...")
      await commitTranslatedFilesViaApi({
        octokit,
        owner: repoOwner!,
        repo: repoName!,
        branch: gitBranchName!,
        files: filesModified,
        log,
      })
      log("Successfully committed translated files.")
    } else if (commitChanges && filesModified.length === 0) {
      log("Commit changes enabled, but no files were modified.")
    }

  } catch (error) {
    hadError = true
    const errorMsg = "Workflow Script Error: " + (error as Error).message
    console.error(errorMsg)
    log(errorMsg)
  } finally {
    if (octokit && repoOwner && repoName && issueNumber) {
      try {
        const commentBody = `## JSON Translation Sync Results

**Summary:**
- Files modified: ${filesModified.length}
- Files with errors: ${filesErrored.length}
- Total target files processed: ${targetFiles.length}

**Modified Files:**
${filesModified.length > 0 ? filesModified.map(f => `- \`${f}\``).join('\n') : 'None'}

**Files with Errors:**
${filesErrored.length > 0 ? filesErrored.map(f => `- \`${f}\``).join('\n') : 'None'}

**Log Output:**
\`\`\`
${logs.join('\n')}
\`\`\``

        await octokit.rest.issues.createComment({
          owner: repoOwner,
          repo: repoName,
          issue_number: parseInt(issueNumber),
          body: commentBody
        })
        log("Successfully posted comment to GitHub PR")
      } catch (commentError) {
        console.error(`Failed to post comment to GitHub: ${(commentError as Error).message}`)
        log(`Failed to post comment to GitHub: ${(commentError as Error).message}`)
      }
    } else {
      log("Skipping GitHub comment - missing required environment variables (GITHUB_TOKEN, GITHUB_REPOSITORY_OWNER, GITHUB_REPOSITORY, or GITHUB_ISSUE_NUMBER)")
    }
  }

  if (hadError) {
    process.exit(1)
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
