#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');

const { runImprovementCycle } = require('../lib/improver');
const { commitAndPush, getChangelog, getDiff } = require('../lib/publisher');
const { getSkillPath, readSkillMd, generateEvals } = require('../lib/runner');

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const skillName = args[1] || 'image-analyzer';
const token = process.env.GITHUB_TOKEN || '';

function help() {
  console.log(`
  aim - Auto IMprover for Claude Code Skills  v1.0.0

  Usage: aim <command> [skill-name] [options]

  Commands:
    improve [name]      运行完整改进循环（测试→评估→改进→重复）
    quick [name]        快速检查并生成改进建议（不自动应用）
    push [name]         提交改进并推送到 GitHub
    test [name]         仅运行测试，不进行改进
    status [name]       查看 skill 当前状态
    help                显示帮助

  Options:
    --iterations N      最大改进迭代次数（默认 3）
    --auto-push         改进后自动推送

  Examples:
    aim improve image-analyzer
    aim improve image-analyzer --iterations 5 --auto-push
    aim test image-analyzer
    aim quick frontend-design

  Set GITHUB_TOKEN env var to enable auto-push.
`);
}

async function cmdImprove(name, opts) {
  console.log(`\n╔══════════════════════════════════════════════════════╗`);
  console.log(`║  Auto IMprover - ${name.padEnd(38)}║`);
  console.log(`╚══════════════════════════════════════════════════════╝`);

  // Backup current SKILL.md
  const skillPath = getSkillPath(name);
  const md = readSkillMd(skillPath);
  if (!md) {
    console.log(`\n  Skill "${name}" not found\n`);
    return;
  }

  const backupDir = path.join(skillPath, 'improve-workspace', 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `SKILL-${Date.now()}.md`);
  fs.copyFileSync(md.path, backupFile);
  console.log(`  Backup: ${backupFile}\n`);

  // Show current stats
  const evals = generateEvals(name);
  console.log(`  Test prompts: ${evals.length}`);
  console.log(`  SKILL.md size: ${(md.content.length / 1024).toFixed(1)} KB`);
  console.log(`  Sections: ${(md.content.match(/^## /gm) || []).length}`);
  console.log();

  // Run improvement cycle
  const result = await runImprovementCycle(name, {
    iterations: opts.iterations || 3
  });

  if (!result.ok) {
    console.log(`  Error: ${result.error}\n`);
    return;
  }

  // Print summary
  console.log(`  ┌────────────────────────────────────────────────────┐`);
  console.log(`  │  Improvement Summary                               │`);
  console.log(`  ├────────────────────────────────────────────────────┤`);
  for (const r of result.results) {
    const bar = '█'.repeat(Math.round(r.avgRate * 20)) + '░'.repeat(20 - Math.round(r.avgRate * 20));
    console.log(`  │  Iter ${r.iteration}: ${bar} ${(r.avgRate * 100).toFixed(0)}%${' '.repeat(4)}│`);
  }
  console.log(`  └────────────────────────────────────────────────────┘`);

  // Show the diff
  const diff = getDiff(skillPath);
  if (diff) {
    console.log(`\n  Changes made to SKILL.md:\n`);
    console.log('  ' + diff.split('\n').join('\n  '));
  }

  // Auto-push if requested
  if (opts.autoPush && token) {
    console.log(`\n  Auto-pushing...`);
    const push = commitAndPush(skillPath, `auto: improve ${name} via aim`, token);
    console.log(`  ${push.ok ? '✓' : '✗'} ${push.message || push.error}\n`);
  } else if (opts.autoPush && !token) {
    console.log(`\n  Set GITHUB_TOKEN to enable auto-push\n`);
  }

  if (!opts.autoPush) {
    console.log(`\n  To apply changes: aim push ${name}`);
    console.log(`  To revert: cp ${backupFile} ${md.path}\n`);
  }
}

async function main() {
  const opts = {
    iterations: parseInt(args.find(a => a.startsWith('--iterations'))?.split('=')[1] || '3'),
    autoPush: args.includes('--auto-push')
  };

  switch (cmd) {
    case 'improve':
      await cmdImprove(skillName, opts);
      break;
    case 'quick':
      console.log(`\n  Quick check for "${skillName}"...\n`);
      const { analyzeWithClaude, parseSuggestions } = require('../lib/improver');
      const skillPath = getSkillPath(skillName);
      const md = readSkillMd(skillPath);
      if (!md) { console.log(`  Skill not found\n`); break; }
      const fakeResults = [{ id: 0, prompt: 'general quality check', passed: false, passRate: 0.5, issues: ['quality check'] }];
      const ws = path.join(skillPath, 'improve-workspace', 'quick');
      fs.mkdirSync(ws, { recursive: true });
      const a = analyzeWithClaude(md.path, fakeResults, ws);
      if (a.success) {
        const suggestions = parseSuggestions(a.suggestions);
        console.log(`  Found ${suggestions.length} suggestion(s):\n`);
        suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s.title}\n     ${s.why}\n`));
      } else {
        console.log(`  Analysis failed: ${a.error}\n`);
      }
      break;
    case 'test':
      console.log(`\n  Running tests for "${skillName}"...\n`);
      const { runEvalWithSkill, gradeOutput, generateEvals, getSkillPath: gp, createWorkspace } = require('../lib/runner');
      const sp = gp(skillName);
      const ep = generateEvals(skillName);
      const tws = createWorkspace(sp, 1);
      for (const ev of ep) {
        process.stdout.write(`  Eval #${ev.id}...\r`);
        const out = runEvalWithSkill(sp, ev.prompt, path.join(tws, `eval-${ev.id}`));
        const grade = gradeOutput(out.output, ev.expected_output);
        const icon = grade.passRate >= 0.6 ? '✓' : '✗';
        console.log(`  ${icon} Eval #${ev.id}: ${ev.prompt.substring(0, 50)}... → ${(grade.passRate * 100).toFixed(0)}%[K`);
      }
      console.log();
      break;
    case 'push':
      const psp = getSkillPath(skillName);
      const ch = getChangelog(psp, 1);
      const diff = getDiff(psp);
      if (!diff) { console.log(`\n  No changes to push\n`); break; }
      console.log(`\n  Changes to push:\n`);
      console.log('  ' + diff.split('\n').join('\n  '));
      if (token) {
        const r = commitAndPush(psp, `auto: improve ${skillName} via aim`, token);
        console.log(`\n  ${r.ok ? '✓ Pushed' : '✗ ' + r.error}\n`);
      } else {
        console.log(`\n  Set GITHUB_TOKEN to push automatically, or push manually.\n`);
      }
      break;
    case 'status':
      const ssp = getSkillPath(skillName);
      const smd = readSkillMd(ssp);
      if (!smd) { console.log(`\n  Skill "${skillName}" not found\n`); break; }
      const cl = getChangelog(ssp, 5);
      console.log(`\n  ${skillName}`);
      console.log(`  ${'─'.repeat(50)}`);
      console.log(`  SKILL.md: ${(smd.content.length / 1024).toFixed(1)} KB`);
      console.log(`  Sections: ${(smd.content.match(/^## /gm) || []).length}`);
      console.log(`\n  Recent commits:\n  ${cl.split('\n').join('\n  ')}`);
      console.log();
      break;
    default:
      help();
  }
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
