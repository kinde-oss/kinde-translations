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

    process.stdout.write("Source File Path: " + sourceFilePath + "\n");
    process.stdout.write(
      "Target JSON Glob Pattern: " + targetJsonGlobPattern + "\n"
    )
    process.stdout.write("Base Commit SHA: " + baseSha + "\n")
    process.stdout.write("Head Commit SHA: " + headSha + "\n")
    process.stdout.write("Git Branch Name: " + gitBranchName + "\n")
    process.stdout.write("DeepL API Key: " + !!deeplApiKey ? 'Set' : 'unset' + "\n")


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

    // 2. Calculate differences from the source file's history
    process.stdout.write("Calculating differences...\n")
    const differences = await getJsonFileDifferencesBetweenCommits(
      sourceFilePath,
      baseSha,
      headSha
    )
    process.stdout.write(
      "Calculated Differences: " + JSON.stringify(differences, null, 2) + "\n"
    )

    // 3. Resolve glob pattern to a list of target files
    process.stdout.write(
      `Searching for target files with pattern: ${targetJsonGlobPattern}\n`
    )
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
      console.warn(
        "No target JSON files found matching the glob pattern and exclusion. No files will be updated."
      )
      return
    }

    

    process.stdout.write(
      "Found target files: " +
        targetFiles.map((file) => file.split("/")[0]).join(", ") +
        "\n"
    )

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

      process.stdout.write(
        `➡️ Updating ${targetLangCode} ...`
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
          `❌ \n\tError processing ${targetFilePath}: ${(error as Error).message}`
        )
        filesErrored.push(targetFilePath)
      }
    }

    process.stdout.write(
      "All target files synchronization and translation attempt complete!\n"
    )

    // 5. Optional: Commit and push changes if enabled
    if (commitChanges && filesModified.length > 0) {
      process.stdout.write("Committing and pushing translated files...\n")
      execSync('git config user.name "github-actions[bot]"')
      execSync(
        'git config user.email "github-actions[bot]@users.noreply.github.com"'
      )

      process.stdout.write("checkout: " + gitBranchName + "\n")
      execSync(`git checkout ${gitBranchName}`)

      for (const filePath of filesModified) {
        execSync(`git add "${filePath}"`)
      }

      try {
        execSync("git diff-index --quiet HEAD --")
        process.stdout.write("No actual changes detected to commit.\n")
      } catch (e) {
        try {
          execSync('git commit -m "chore: Auto-translate JSON files"')
          execSync("git push")
          process.stdout.write(
            "Successfully committed and pushed translated files.\n"
          )
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
      process.stdout.write(
        "Commit changes enabled, but no files were modified.\n"
      )
    }
  } catch (error) {
    console.error("Workflow Script Error:", (error as Error).message)
    process.exit(1)
  }
}

run()
