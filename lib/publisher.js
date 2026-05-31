const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function commitAndPush(skillPath, message, token) {
  try {
    // Stage SKILL.md
    execSync('git add SKILL.md', { cwd: skillPath, encoding: 'utf8', timeout: 10000 });

    // Check if there are staged changes
    const status = execSync('git diff --cached --quiet', { cwd: skillPath, encoding: 'utf8', timeout: 5000 });
    // If we get here with exit 0, there are no changes
    return { ok: true, message: 'no changes to commit' };
  } catch (e) {
    // diff --cached --quiet exits with 1 if there are changes, which triggers the catch
    if (e.status === 1) {
      // There are changes, proceed with commit
      try {
        execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
          cwd: skillPath, encoding: 'utf8', timeout: 15000
        });

        if (token) {
          const remoteUrl = execSync('git remote get-url origin', { cwd: skillPath, encoding: 'utf8', timeout: 5000 }).trim();
          const authUrl = remoteUrl.replace('https://github.com', `https://oauth2:${token}@github.com`);
          execSync(`git remote set-url origin "${authUrl}"`, { cwd: skillPath, timeout: 5000 });
          execSync('git push', { cwd: skillPath, encoding: 'utf8', timeout: 30000 });
          execSync(`git remote set-url origin "${remoteUrl}"`, { cwd: skillPath, timeout: 5000 });
        }

        return { ok: true, message: 'committed and pushed' };
      } catch (e2) {
        return { ok: false, error: `Commit/push failed: ${e2.message}` };
      }
    }
    return { ok: false, error: `Git status check failed: ${e.message}` };
  }
}

function getChangelog(skillPath, lastN = 5) {
  try {
    return execSync(`git log --oneline -${lastN}`, {
      cwd: skillPath, encoding: 'utf8', timeout: 5000
    }).trim();
  } catch (_) {
    return 'No git history';
  }
}

function getDiff(skillPath) {
  try {
    return execSync('git diff SKILL.md', {
      cwd: skillPath, encoding: 'utf8', timeout: 5000
    }).trim();
  } catch (_) {
    return '';
  }
}

module.exports = { commitAndPush, getChangelog, getDiff };
