import {
  getJsonFileDifferencesBetweenCommits,
  applyJsonDifferencesToFile,
} from "./json-diff-checker"
const { glob } = require("glob")
const path = require("path")
const { execSync } = require("child_process") // Needed if you want to commit/push changes
require("dotenv").config()

async function run() {
  try {
    // 1. Get environment variables
    const sourceFilePath = process.env.SOURCE_JSON_FILE_PATH
    const targetJsonGlobPattern = process.env.TARGET_JSON_GLOB_PATTERN
    const excludeFromTargetGlob = process.env.EXCLUDE_FROM_TARGET_GLOB
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

    if (
      !sourceFilePath ||
      !targetJsonGlobPattern ||
      !baseSha ||
      !headSha ||
      !deeplApiKey
    ) {
      throw new Error(
        "Missing required environment variables. Ensure SOURCE_JSON_FILE_PATH, TARGET_JSON_GLOB_PATTERN, BASE_COMMIT_SHA, HEAD_COMMIT_SHA, and DEEPL_API_KEY are set."
      )
    }

    // 2. Calculate differences from the source file's history
    console.log("Calculating differences...")
    const differences = await getJsonFileDifferencesBetweenCommits(
      sourceFilePath,
      baseSha,
      headSha
    )
    console.log("Calculated Differences:", JSON.stringify(differences, null, 2))

    // 3. Resolve glob pattern to a list of target files
    console.log(
      `Searching for target files with pattern: ${targetJsonGlobPattern}`
    )
    const targetFiles = await glob(targetJsonGlobPattern, {
      // ignore: [excludeFromTargetGlob],
      // cwd: process.cwd(),
    })

    if (targetFiles.length === 0) {
      console.warn(
        "No target JSON files found matching the glob pattern and exclusion. No files will be updated."
      )
      return
    }

    console.log("Found target files:", targetFiles)

    let filesModified = []

    // 4. Iterate through each target file and apply differences with translation
    for (const targetFilePath of targetFiles) {
      const dirName = path.basename(path.dirname(targetFilePath))
      let targetLangCode = dirName.toUpperCase()

      switch (targetLangCode) {
        case "EN":
          targetLangCode = "EN-US"
          break
        case "PT":
          targetLangCode = "PT-PT"
          break
        case "ZH":
          targetLangCode = "ZH"
          break
      }

      console.log(
        `Applying differences to ${targetFilePath} with translation to ${targetLangCode}...`
      )
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
        console.error(
          `Error processing ${targetFilePath}: ${(error as Error).message}`
        )
      }
    }

    console.log(
      "All target files synchronization and translation attempt complete!"
    )

    // 5. Optional: Commit and push changes if enabled
    if (commitChanges && filesModified.length > 0) {
      console.log("Committing and pushing translated files...")
      execSync('git config user.name "github-actions[bot]"')
      execSync(
        'git config user.email "github-actions[bot]@users.noreply.github.com"'
      )
      
      console.log("checkout:", gitBranchName)
      execSync(`git checkout ${gitBranchName}`)

      for (const filePath of filesModified) {
        execSync(`git add "${filePath}"`)
      }

      try {
        execSync("git diff-index --quiet HEAD --")
        console.log("No actual changes detected to commit.")
      } catch (e) {
        try {
          execSync('git commit -m "chore: Auto-translate JSON files"')
          execSync("git push")
          console.log("Successfully committed and pushed translated files.")
        } catch (commitPushError) {
          console.error(
            `Failed to commit or push changes: ${
              (commitPushError as Error).message
            }`
          )
          throw new Error(
            `Git commit/push failed: ${(commitPushError as Error).message}`
          )
        }
      }
    } else if (commitChanges && filesModified.length === 0) {
      console.log("Commit changes enabled, but no files were modified.")
    }
  } catch (error) {
    console.error("Workflow Script Error:", (error as Error).message)
    process.exit(1)
  }
}

run()
