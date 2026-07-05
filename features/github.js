// ================================================================
// GitHub Control — Repo management, Issues, PRs, Git operations
// ================================================================
// Uses GitHub CLI (gh) — must be installed
// ================================================================

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// ================================================================
// Check if GitHub CLI is available
// ================================================================
let _ghAvailable = null;
let _ghCheckPromise = null;

async function isGhAvailable() {
  if (_ghAvailable !== null) return _ghAvailable;
  if (_ghCheckPromise) return _ghCheckPromise;
  
  _ghCheckPromise = (async () => {
    try {
      await execAsync('gh --version', { timeout: 5000 });
      _ghAvailable = true;
      return true;
    } catch (e) {
      _ghAvailable = false;
      return false;
    }
  })();
  
  return _ghCheckPromise;
}

// ================================================================
// Run gh command safely
// ================================================================
async function gh(command, timeout = 15000) {
  const available = await isGhAvailable();
  if (!available) {
    return { error: 'GitHub CLI (gh) not installed. Install from https://cli.github.com/' };
  }
  try {
    const { stdout, stderr } = await execAsync(`gh ${command}`, { timeout, maxBuffer: 1024 * 1024 });
    return { output: stdout.trim() || stderr.trim() || '(empty)' };
  } catch (e) {
    if (e.stdout || e.stderr) {
      return { output: (e.stdout || '').trim() + '\n' + (e.stderr || '').trim() };
    }
    return { error: e.message };
  }
}

// ================================================================
// GitHub Auth Status
// ================================================================
async function authStatus() {
  const result = await gh('auth status');
  if (result.error) return result;
  return { output: result.output, authenticated: !result.output.includes('not logged in') };
}

// ================================================================
// List repositories
// ================================================================
async function listRepos(owner = '', limit = 10) {
  const filter = owner ? `--owner ${owner}` : '';
  return gh(`repo list ${filter} --limit ${limit} --json name,description,owner,isPrivate,updatedAt`);
}

// ================================================================
// Create issue
// ================================================================
async function createIssue(repo, title, body = '') {
  return gh(`issue create --repo ${repo} --title "${title.replace(/"/g, '\\"')}" --body "${body.replace(/"/g, '\\"')}"`, 30000);
}

// ================================================================
// List issues
// ================================================================
async function listIssues(repo, state = 'open', limit = 10) {
  return gh(`issue list --repo ${repo} --state ${state} --limit ${limit} --json number,title,state,updatedAt,labels`);
}

// ================================================================
// List PRs
// ================================================================
async function listPRs(repo, state = 'open', limit = 10) {
  return gh(`pr list --repo ${repo} --state ${state} --limit ${limit} --json number,title,state,headRefName,baseRefName,updatedAt`);
}

// ================================================================
// View issue/PR
// ================================================================
async function viewItem(repo, number) {
  const result = await gh(`issue view --repo ${repo} ${number} --json title,body,state,author,labels,comments`);
  if (!result.error) return { type: 'issue', ...result };
  return gh(`pr view --repo ${repo} ${number} --json title,body,state,author,additions,deletions`);
}

// ================================================================
// Git status for current project
// ================================================================
async function gitStatus(projectPath = process.cwd()) {
  try {
    const { stdout } = await execAsync('git status --short', { cwd: projectPath, timeout: 10000 });
    if (!stdout.trim()) return { clean: true, message: 'Working tree clean' };
    const lines = stdout.trim().split('\n');
    return { clean: false, changes: lines.length, details: stdout.trim() };
  } catch (e) {
    return { error: `Git error: ${e.message}` };
  }
}

// ================================================================
// Git commit and push (respects .gitignore via git add -A)
// ================================================================
async function gitCommit(projectPath, message) {
  try {
    // Use git add -A (respects .gitignore) instead of git add .
    const { stdout: addOut } = await execAsync('git add -A', { cwd: projectPath, timeout: 10000 });
    const { stdout: commitOut } = await execAsync(
      'git commit -m "' + message.replace(/"/g, '\\"') + '"',
      { cwd: projectPath, timeout: 15000 }
    );
    return { output: commitOut.trim() };
  } catch (e) {
    if (e.stdout && e.stdout.includes('nothing to commit')) {
      return { output: 'Nothing to commit, working tree clean' };
    }
    return { error: e.message, output: e.stdout || '' };
  }
}

async function gitPush(projectPath) {
  try {
    const { stdout } = await execAsync('git push', { cwd: projectPath, timeout: 60000 });
    return { output: stdout.trim() };
  } catch (e) {
    return { error: e.message, output: e.stdout || '' };
  }
}

async function gitPull(projectPath) {
  try {
    const { stdout } = await execAsync('git pull', { cwd: projectPath, timeout: 30000 });
    return { output: stdout.trim() };
  } catch (e) {
    return { error: e.message, output: e.stdout || '' };
  }
}

// ================================================================
// Search code on GitHub
// ================================================================
async function searchCode(query, limit = 5) {
  return gh(`search code "${query.replace(/"/g, '\\"')}" --limit ${limit} --json path,repository,name`, 30000);
}

// ================================================================
// View repository info
// ================================================================
async function repoInfo(repo) {
  return gh(`repo view ${repo} --json name,description,url,homepageUrl,primaryLanguage,stargazerCount,forkCount,updatedAt,owner`, 15000);
}

module.exports = {
  isGhAvailable,
  authStatus,
  listRepos,
  createIssue,
  listIssues,
  listPRs,
  viewItem,
  gitStatus,
  gitCommit,
  gitPush,
  gitPull,
  searchCode,
  repoInfo,
  gh,
};
