import { Octokit } from "@octokit/rest";

export interface GitHubConfig {
  token: string;
  owner?: string;
  repo?: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  url: string;
  state: string;
}

export interface GitHubPR {
  number: number;
  title: string;
  url: string;
  state: string;
}

export interface RepoHealth {
  openIssues: number;
  openPRs: number;
  lastPush?: string;
}

function oc(token: string) {
  return new Octokit({ auth: token });
}

function resolveOwnerRepo(config: GitHubConfig, params: { owner?: string; repo?: string }) {
  const owner = params.owner ?? config.owner;
  const repo = params.repo ?? config.repo;
  if (!owner || !repo) throw new Error("GitHub owner and repo are required");
  return { owner, repo };
}

export async function createIssue(
  config: GitHubConfig,
  params: {
    owner?: string;
    repo?: string;
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  }
): Promise<GitHubIssue> {
  const { owner, repo } = resolveOwnerRepo(config, params);
  const { data } = await oc(config.token).issues.create({
    owner, repo,
    title: params.title,
    body: params.body,
    labels: params.labels,
    assignees: params.assignees,
  });
  return { number: data.number, title: data.title, url: data.html_url, state: data.state };
}

export async function commentOnIssue(
  config: GitHubConfig,
  params: { owner?: string; repo?: string; issueNumber: number; body: string }
): Promise<{ id: number; url: string }> {
  const { owner, repo } = resolveOwnerRepo(config, params);
  const { data } = await oc(config.token).issues.createComment({
    owner, repo, issue_number: params.issueNumber, body: params.body,
  });
  return { id: data.id, url: data.html_url };
}

export async function createPR(
  config: GitHubConfig,
  params: {
    owner?: string;
    repo?: string;
    title: string;
    body?: string;
    head: string;
    base?: string;
    draft?: boolean;
  }
): Promise<GitHubPR> {
  const { owner, repo } = resolveOwnerRepo(config, params);
  const { data } = await oc(config.token).pulls.create({
    owner, repo,
    title: params.title,
    body: params.body ?? "",
    head: params.head,
    base: params.base ?? "main",
    draft: params.draft ?? false,
  });
  return { number: data.number, title: data.title, url: data.html_url, state: data.state };
}

export async function labelIssue(
  config: GitHubConfig,
  params: { owner?: string; repo?: string; issueNumber: number; labels: string[] }
): Promise<void> {
  const { owner, repo } = resolveOwnerRepo(config, params);
  await oc(config.token).issues.addLabels({
    owner, repo, issue_number: params.issueNumber, labels: params.labels,
  });
}

export async function closeIssue(
  config: GitHubConfig,
  params: { owner?: string; repo?: string; issueNumber: number; comment?: string }
): Promise<void> {
  const { owner, repo } = resolveOwnerRepo(config, params);
  const octokit = oc(config.token);
  if (params.comment) {
    await octokit.issues.createComment({ owner, repo, issue_number: params.issueNumber, body: params.comment });
  }
  await octokit.issues.update({ owner, repo, issue_number: params.issueNumber, state: "closed" });
}

export async function getRepoHealth(
  config: GitHubConfig,
  params: { owner?: string; repo?: string }
): Promise<RepoHealth> {
  const { owner, repo } = resolveOwnerRepo(config, params);
  const octokit = oc(config.token);
  const [repoData, prs] = await Promise.all([
    octokit.repos.get({ owner, repo }),
    octokit.pulls.list({ owner, repo, state: "open", per_page: 100 }),
  ]);
  return {
    openIssues: Math.max(0, (repoData.data.open_issues_count ?? 0) - prs.data.length),
    openPRs: prs.data.length,
    lastPush: repoData.data.pushed_at ?? undefined,
  };
}

export async function testConnection(config: GitHubConfig): Promise<{ login: string; name: string }> {
  const { data } = await oc(config.token).users.getAuthenticated();
  return { login: data.login, name: data.name ?? data.login };
}

export async function runGitHubOperation(
  config: GitHubConfig,
  operation: string,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  switch (operation) {
    case "create_issue": {
      const r = await createIssue(config, input as Parameters<typeof createIssue>[1]);
      return r as unknown as Record<string, unknown>;
    }
    case "comment_on_issue": {
      const r = await commentOnIssue(config, input as Parameters<typeof commentOnIssue>[1]);
      return r as unknown as Record<string, unknown>;
    }
    case "create_pr": {
      const r = await createPR(config, input as Parameters<typeof createPR>[1]);
      return r as unknown as Record<string, unknown>;
    }
    case "label_issue":
      await labelIssue(config, input as Parameters<typeof labelIssue>[1]);
      return { ok: true };
    case "close_issue":
      await closeIssue(config, input as Parameters<typeof closeIssue>[1]);
      return { ok: true };
    case "get_repo_health": {
      const r = await getRepoHealth(config, input as Parameters<typeof getRepoHealth>[1]);
      return r as unknown as Record<string, unknown>;
    }
    default:
      throw new Error(`Unknown GitHub operation: ${operation}`);
  }
}
