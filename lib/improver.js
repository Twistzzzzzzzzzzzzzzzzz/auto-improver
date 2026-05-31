const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Use Claude API to analyze eval results and suggest specific SKILL.md improvements
function analyzeWithClaude(skillMdPath, evalResults, workspaceDir) {
  const resultsSummary = evalResults.map(r =>
    `Eval #${r.id}: ${r.passed ? 'PASS' : 'FAIL'} (rate: ${(r.passRate * 100).toFixed(0)}%)\n  Prompt: ${r.prompt}\n  Issues: ${r.issues.join(', ') || 'none'}`
  ).join('\n\n');

  const prompt = `
You are reviewing a Claude Code skill called "image-analyzer". Here are the current eval results:

${resultsSummary}

Current SKILL.md content:
---
${fs.readFileSync(skillMdPath, 'utf8').substring(0, 5000)}
---

Based on the failures and weaknesses in the eval results, propose 3-5 specific, actionable improvements to SKILL.md. For each improvement:

1. What to change (specific section/line)
2. Why it needs to change (which eval failure it addresses)
3. The new text to use

Focus on:
- Template completeness (are all required fields present?)
- Decision tree accuracy (is scene detection working?)
- Output format clarity (are instructions unambiguous?)
- Edge case handling (mixed content, error images, etc.)
- Trigger description coverage

Output format:
### Improvement 1: [title]
**What:** [specific change]
**Why:** [eval failure addressed]
**New text:**
\`\`\`markdown
[the replacement text]
\`\`\`
`;

  const analysisFile = path.join(workspaceDir, 'analysis-prompt.md');
  fs.writeFileSync(analysisFile, prompt);

  try {
    const result = execSync(
      `claude -p "${prompt.replace(/"/g, '\\"').replace(/\n/g, '\\n')}" --output-format text --max-turns 3`,
      { encoding: 'utf8', timeout: 120000, maxBuffer: 5 * 1024 * 1024 }
    );
    const resultFile = path.join(workspaceDir, 'improvement-suggestions.md');
    fs.writeFileSync(resultFile, result);
    return { success: true, suggestions: result, file: resultFile };
  } catch (e) {
    return { success: false, error: e.message, suggestions: e.stdout || '' };
  }
}

// Parse improvement suggestions into actionable edits
function parseSuggestions(suggestionsText) {
  const improvements = [];
  const sections = suggestionsText.split(/### Improvement \d+:/);
  sections.shift(); // remove preamble

  for (const section of sections) {
    const titleMatch = section.match(/^(.+)/);
    const whatMatch = section.match(/\*\*What:\*\*\s*(.+)/);
    const whyMatch = section.match(/\*\*Why:\*\*\s*(.+)/);
    const codeMatch = section.match(/```markdown\s*([\s\S]*?)```/);

    if (titleMatch && codeMatch) {
      improvements.push({
        title: titleMatch[1].trim(),
        what: whatMatch ? whatMatch[1].trim() : '',
        why: whyMatch ? whyMatch[1].trim() : '',
        newText: codeMatch[1].trim()
      });
    }
  }
  return improvements;
}

// Apply an improvement to SKILL.md (append or replace)
function applyImprovement(skillMdPath, improvement, mode = 'append') {
  const content = fs.readFileSync(skillMdPath, 'utf8');

  if (mode === 'append') {
    // Append as a new section before the last section
    const marker = '## 注意事项';
    const idx = content.lastIndexOf(marker);
    if (idx > 0) {
      const newContent = content.substring(0, idx) +
        `### ${improvement.title}\n\n${improvement.newText}\n\n` +
        content.substring(idx);
      fs.writeFileSync(skillMdPath, newContent);
      return true;
    }
  }

  // For replace mode, try to find and replace
  if (improvement.what && improvement.what.includes('replace')) {
    const oldMatch = improvement.what.match(/replace\s+"([^"]+)"/i) ||
                     improvement.what.match(/替换\s+"([^"]+)"/i);
    if (oldMatch) {
      const oldText = oldMatch[1];
      const newContent = content.replace(oldText, improvement.newText);
      if (newContent !== content) {
        fs.writeFileSync(skillMdPath, newContent);
        return true;
      }
    }
  }

  // If no specific replacement, append as improvement section
  if (mode === 'append') {
    return false; // already tried
  }

  const newSection = `\n\n## ${improvement.title}\n\n${improvement.newText}\n`;
  fs.appendFileSync(skillMdPath, newSection);
  return true;
}

// Run the full improvement cycle
async function runImprovementCycle(skillName, options = {}) {
  const { SKILLS_DIR } = require('./runner');
  const skillPath = path.join(SKILLS_DIR, skillName);
  const skillMdPath = path.join(skillPath, 'SKILL.md');

  if (!fs.existsSync(skillMdPath)) {
    return { ok: false, error: `Skill "${skillName}" not found` };
  }

  const { generateEvals, runEvalWithSkill, gradeOutput, createWorkspace } = require('./runner');

  const maxIterations = options.iterations || 3;
  const results = [];

  console.log(`\n  Auto-improving "${skillName}" (max ${maxIterations} iterations)...\n`);

  for (let iter = 0; iter < maxIterations; iter++) {
    console.log(`  Iteration ${iter + 1}/${maxIterations}:`);
    const ws = createWorkspace(skillPath, iter + 1);

    // Generate and run evals
    const evalPrompts = generateEvals(skillName);
    if (evalPrompts.length === 0) {
      console.log(`    No test prompts defined for "${skillName}"\n`);
      break;
    }

    const evalResults = [];
    for (const ev of evalPrompts) {
      process.stdout.write(`    Eval #${ev.id}...\r`);
      const evalDir = path.join(ws, `eval-${ev.id}`);
      const out = runEvalWithSkill(skillPath, ev.prompt, evalDir);
      const grade = gradeOutput(out.output, ev.expected_output);
      const issues = grade.expectations.filter(e => !e.passed).map(e => e.text);

      evalResults.push({
        id: ev.id,
        prompt: ev.prompt,
        passed: grade.passRate >= 0.6,
        passRate: grade.passRate,
        grade,
        issues
      });

      const icon = grade.passRate >= 0.6 ? '✓' : '✗';
      console.log(`    ${icon} Eval #${ev.id}: ${(grade.passRate * 100).toFixed(0)}% (${grade.passed}/${grade.total})[K`);
    }

    // Save eval results
    fs.writeFileSync(path.join(ws, 'eval-results.json'), JSON.stringify(evalResults, null, 2));

    const avgRate = evalResults.reduce((a, r) => a + r.passRate, 0) / evalResults.length;
    const allPassed = evalResults.every(r => r.passed);

    console.log(`    Average: ${(avgRate * 100).toFixed(0)}%`);

    results.push({ iteration: iter + 1, avgRate, evalResults, workspace: ws });

    // If all pass or this is the last iteration, stop
    if (allPassed) {
      console.log(`    All evals passed. Stopping.\n`);
      break;
    }

    if (iter < maxIterations - 1) {
      console.log(`    Generating improvements...`);
      const analysis = analyzeWithClaude(skillMdPath, evalResults, ws);
      if (analysis.success) {
        const improvements = parseSuggestions(analysis.suggestions);
        console.log(`    Found ${improvements.length} improvement(s)`);
        for (const imp of improvements) {
          const applied = applyImprovement(skillMdPath, imp);
          console.log(`    ${applied ? '✓' : '✗'} Applied: ${imp.title}`);
        }
      } else {
        console.log(`    Analysis failed: ${analysis.error}`);
      }
    }
    console.log();
  }

  return { ok: true, skillName, skillPath, results };
}

module.exports = { analyzeWithClaude, parseSuggestions, applyImprovement, runImprovementCycle };
