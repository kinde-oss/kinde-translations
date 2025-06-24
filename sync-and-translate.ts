import {
  getJsonFileDifferencesBetweenCommits,
  applyJsonDifferencesToFile,
} from "./json-diff-checker"
const { glob } = require("glob")
const path = require("path")
const { execSync } = require("child_process") // Needed if you want to commit/push changes
const { Octokit } = require("@octokit/rest") // Add GitHub API client
require("dotenv").config()

async function run() {
  try {
    // 1. Get environment variables
    const sourceFilePath = process.env.SOURCE_JSON_FILE_PATH
    const targetJsonGlobPattern = process.env.TARGET_JSON_GLOB_PATTERN
    const baseSha = process.env.BASE_COMMIT_SHA
    const headSha = process.env.HEAD_COMMIT_SHA
    const gitBranchName = process.env.GIT_BRANCH_NAME
    const deeplApiKey = process.env.DEEPL_API_KEY
    const commitChanges = process.env.COMMIT_CHANGES === "true"
    const isDeepLFreeApi = process.env.IS_DEEPL_FREE_API === "true"
    // NEW: Get the non-splitting tags from environment variable
    const deeplNonSplittingTagsStr = process.env.DEEPL_NON_SPLITTING_TAGS
    const deeplNonSplittingTags = deeplNonSplittingTagsStr
      ? deeplNonSplittingTagsStr.split(",")
      : undefined

    // GitHub API setup
    const githubToken = process.env.GITHUB_TOKEN
    const octokit = githubToken ? new Octokit({ auth: githubToken }) : null
    const repoOwner = process.env.GITHUB_REPOSITORY_OWNER
    const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]
    const issueNumber = process.env.GITHUB_ISSUE_NUMBER

    // Capture logs for the comment
    const logs: string[] = []

    const log = (message: string) => {
      process.stdout.write(message + "\n")
      logs.push(message)
    }

    log("Source File Path: " + sourceFilePath)
    log("Target JSON Glob Pattern: " + targetJsonGlobPattern)
    log("Base Commit SHA: " + baseSha)
    log("Head Commit SHA: " + headSha)
    log("Git Branch Name: " + gitBranchName)
    log("DeepL API Key: " + (!!deeplApiKey ? 'Set' : 'unset'))

    console.log(
      !sourceFilePath,
      !targetJsonGlobPattern,
      !baseSha,
      !headSha,
      !deeplApiKey, deeplApiKey?.substring(0, 5) + '...',
      (commitChanges && !gitBranchName)
    )

    if (
      !sourceFilePath ||
      !targetJsonGlobPattern ||
      !baseSha ||
      !headSha ||
      !deeplApiKey ||
      !(commitChanges && !gitBranchName)
    ) {
      throw new Error(
        "Missing required environment variables. Ensure SOURCE_JSON_FILE_PATH, TARGET_JSON_GLOB_PATTERN, BASE_COMMIT_SHA, HEAD_COMMIT_SHA, and DEEPL_API_KEY are set."
      )
    }

    // 2. Calculate differences from the source file's history
    log("Calculating differences...")
    const differences = await getJsonFileDifferencesBetweenCommits(
      sourceFilePath,
      baseSha,
      headSha
    )
    log("Calculated Differences: " + JSON.stringify(differences, null, 2))

    // 3. Resolve glob pattern to a list of target files
    log(`Searching for target files with pattern: ${targetJsonGlobPattern}`)
    let targetFiles: string[] = await glob(targetJsonGlobPattern)

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

    let filesModified: string[] = []
    let filesErrored: string[] = []

    // 4. Iterate through each target file and apply differences with translation
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
        // Pass the non-splitting tags to applyJsonDifferencesToFile
        await applyJsonDifferencesToFile(
          targetFilePath,
          differences,
          targetLangCode,
          deeplApiKey,
          isDeepLFreeApi,
          deeplNonSplittingTags
        )
        filesModified.push(targetFilePath)
      } catch (error) {
        const errorMsg = `❌ \n\tError processing ${targetFilePath}: ${(error as Error).message}`
        console.error(errorMsg)
        log(errorMsg)
        filesErrored.push(targetFilePath)
      }
    }

    log("All target files synchronization and translation attempt complete!")

    // 5. Optional: Commit and push changes if enabled
    if (commitChanges && filesModified.length > 0) {
      log("Committing and pushing translated files...")
      execSync('git config user.name "github-actions[bot]"')
      execSync(
        'git config user.email "github-actions[bot]@users.noreply.github.com"'
      )

      log("checkout: " + gitBranchName)
      execSync(`git checkout ${gitBranchName}`)

      for (const filePath of filesModified) {
        execSync(`git add "${filePath}"`)
      }

      try {
        execSync("git diff-index --quiet HEAD --")
        log("No actual changes detected to commit.")
      } catch (e) {
        try {
          execSync('git commit -m "chore: Auto-translate JSON files"')
          execSync("git push")
          log("Successfully committed and pushed translated files.")
        } catch (commitPushError) {
          const errorMsg = `Failed to commit or push changes: ${(commitPushError as Error).message}`
          console.error(errorMsg)
          log(errorMsg)
          throw new Error(
            `Git commit/push failed: ${(commitPushError as Error).message}`
          )
        }
      }
    } else if (commitChanges && filesModified.length === 0) {
      log("Commit changes enabled, but no files were modified.")
    }

    // 6. Post comment to GitHub PR if we have the necessary information
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

  } catch (error) {
    const errorMsg = "Workflow Script Error: " + (error as Error).message
    console.error(errorMsg)
    process.exit(1)
  }
}

run()
