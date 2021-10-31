const core = require("@actions/core");
const github = require("@actions/github");
const marked = require("marked");
const { default: findVersions } = require("find-versions");

const versionLabel = "Version: ";
const versionTitlesInMarkdown = ["Version", "New Version"];
const rnInfoTitleInMarkdown = "Output of `react-native info`";
const labelForNoVersion = "Version: unspecified";

const getVersionFromIssueBody = (issueBody) => {
  let versionFromIssueBody;

  // Parse the markdown from the issue body
  const markdownSection = marked.lexer(issueBody);

  // Loop through all sections
  for (const markdownSectionIndex in markdownSection) {
    // If this section matches `versionTitleInMarkdown`
    if (
      versionTitlesInMarkdown.includes(
        markdownSection[markdownSectionIndex].text
      )
    ) {
      // Then the version can be found in the next section
      const specifiedVersion =
        markdownSection[Number(markdownSectionIndex) + 1];

      if (!specifiedVersion.text) {
        continue;
      }

      const foundVersions = findVersions(specifiedVersion.text, {
        loose: true,
      });

      if (foundVersions.length === 0) {
        continue;
      }

      versionFromIssueBody = foundVersions[0];

      break;
    }

    // If this section matches `rnInfoTitleInMarkdown`
    if (markdownSection[markdownSectionIndex].text === rnInfoTitleInMarkdown) {
      // Then the version can be found in the next section
      const rnInfoOutput = markdownSection[Number(markdownSectionIndex) + 1];

      if (!rnInfoOutput.text) {
        continue;
      }

      const rnInfoRNPart = rnInfoOutput.text.match(/react-native(.*)=>/);

      if (!rnInfoRNPart || rnInfoRNPart.length === 0) {
        continue;
      }

      const foundVersions = findVersions(rnInfoRNPart[0], {
        loose: true,
      });

      if (foundVersions.length === 0) {
        continue;
      }

      versionFromIssueBody = foundVersions[0];

      break;
    }
  }

  return versionFromIssueBody;
};

const getLabelToBeApplied = (version) =>
  version ? `${versionLabel}${version}` : labelForNoVersion;

// Look for a version on the issue body
const getIsIssueLabelAVersion = (label) => label.startsWith(versionLabel);

(async () => {
  const githubToken = core.getInput("github-token", { required: true });
  const octokit = github.getOctokit(githubToken);

  const { issue } = github.context;

  // This fetches the issue again as it can have different data after running the other actions
  const { data: updatedIssue } = await octokit.rest.issues.get({
    owner: issue.owner,
    repo: issue.repo,
    issue_number: issue.number,
  });

  if (updatedIssue.state === "closed") {
    // Do nothing if the issue has been closed
    core.debug("Issue already closed");

    return;
  }

  const versionFromIssueBody = getVersionFromIssueBody(updatedIssue.body);
  const labelToBeApplied = getLabelToBeApplied(versionFromIssueBody);

  // Get all the labels in the issue
  const { data: labels } = await octokit.rest.issues.listLabelsOnIssue({
    owner: issue.owner,
    repo: issue.repo,
    issue_number: issue.number,
  });

  // Loop through all labels and remove the version label if it exists
  // and is not the same as the version from the issue body
  await Promise.all(
    labels.map(({ name }) => {
      const isLabelAVersion = getIsIssueLabelAVersion(name);

      if (!isLabelAVersion || name === labelToBeApplied) {
        return;
      }

      return octokit.rest.issues.removeLabel({
        owner: issue.owner,
        repo: issue.repo,
        issue_number: issue.number,
        name,
      });
    })
  );

  try {
    // Make sure that the label to be added exists
    await octokit.rest.issues.getLabel({
      owner: issue.owner,
      repo: issue.repo,
      name: labelToBeApplied,
    });

    // Then add it
    await octokit.rest.issues.addLabels({
      owner: issue.owner,
      repo: issue.repo,
      issue_number: issue.number,
      labels: [labelToBeApplied],
    });
  } catch (_error) {
    // Label does not exist, log it and move on
    core.debug(`Label ${versionAsIssueLabel} does not exist`);
  }
})();
