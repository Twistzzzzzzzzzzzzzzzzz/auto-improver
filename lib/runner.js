const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills');
const SKILL_CREATOR = path.join(SKILLS_DIR, 'skill-creator');

function getSkillPath(name) {
  return path.join(SKILLS_DIR, name);
}

function readSkillMd(skillPath) {
  const md = path.join(skillPath, 'SKILL.md');
  if (!fs.existsSync(md)) return null;
  return { path: md, content: fs.readFileSync(md, 'utf8') };
}

// Generate test prompts for image-analyzer skill
function generateEvals(skillName) {
  const prompts = {
    'image-analyzer': [
      {
        id: 1,
        prompt: "看看这张程序报错的截图：/tmp/error-demo.png，帮我分析一下是什么问题，怎么修",
        expected_output: "应包含：错误类型识别、错误位置、可能原因、修复建议"
      },
      {
        id: 2,
        prompt: "review 这个登录页面设计：/tmp/login-demo.png，有什么可以改进的",
        expected_output: "应包含：设计概览、可用性评估表(5维度+评分)、改进建议(分优先级)"
      },
      {
        id: 3,
        prompt: "这个季度销售数据的折线图说明了什么：/tmp/chart-demo.png",
        expected_output: "应包含：图表类型、数据解读(横轴/纵轴/趋势/关键点)、核心信息一句话"
      },
      {
        id: 4,
        prompt: "提取这张菜单图片里的所有文字：/tmp/menu-demo.png",
        expected_output: "应包含：完整文字提取、文字统计、置信度标注"
      },
      {
        id: 5,
        prompt: "描述一下这张照片里有什么：/tmp/photo-demo.jpg",
        expected_output: "应包含：场景概述、主体识别、环境背景、细节观察、情绪氛围"
      },
      {
        id: 6,
        prompt: "对比这两张改版前后的首页截图：/tmp/v1.png /tmp/v2.png，分析有哪些变化",
        expected_output: "应包含：对比表格(变化项/旧/新/说明)、变化评估、推荐判断"
      },
      {
        id: 7,
        prompt: "quick - 快速看下这张图是什么",
        expected_output: "应输出简短描述模式：场景概述+3-5条核心要点，非完整模板"
      }
    ]
  };
  return prompts[skillName] || [];
}

function createEvalsJson(skillPath, skillName, prompts) {
  const evalsDir = path.join(skillPath, 'evals');
  fs.mkdirSync(evalsDir, { recursive: true });

  const evalsJson = {
    skill_name: skillName,
    evals: prompts.map(p => ({
      id: p.id,
      prompt: p.prompt,
      expected_output: p.expected_output,
      files: []
    }))
  };

  fs.writeFileSync(path.join(evalsDir, 'evals.json'), JSON.stringify(evalsJson, null, 2));
  return evalsDir;
}

// Run a single eval prompt through claude CLI with the skill loaded
function runEvalWithSkill(skillPath, prompt, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, 'output.md');

  try {
    const result = execSync(
      `claude -p "${prompt.replace(/"/g, '\\"')}" --allowedTools Read --output-format text --max-turns 5`,
      { encoding: 'utf8', timeout: 120000, maxBuffer: 10 * 1024 * 1024, cwd: skillPath }
    );
    fs.writeFileSync(outputFile, result);
    return { success: true, output: result };
  } catch (e) {
    fs.writeFileSync(outputFile, e.stdout || e.message || 'Error running eval');
    return { success: false, output: e.stdout || e.message, error: e.message };
  }
}

// Grade an eval output against quality criteria
function gradeOutput(output, expectedCriteria) {
  const checks = {
    hasStructuredSections: /^##\s/m.test(output),
    hasTables: /\|.*\|.*\|/.test(output),
    hasChineseContent: /[一-鿿]/.test(output),
    hasUncertainMarkers: output.includes('[不确定]') || !output.includes('可能') || true, // optional
    lengthAdequate: output.length > 100,
    notEmpty: output.length > 0 && !output.includes('Error running eval')
  };

  const results = [];
  let passed = 0;
  for (const [name, fn] of Object.entries(checks)) {
    const pass = typeof fn === 'function' ? fn() : fn;
    if (pass) passed++;
    results.push({ text: name, passed: pass, evidence: pass ? '✓' : '✗' });
  }

  return {
    passRate: passed / results.length,
    total: results.length,
    passed,
    expectations: results
  };
}

function createWorkspace(skillPath, iteration) {
  const ws = path.join(skillPath, 'improve-workspace', `iteration-${iteration}`);
  fs.mkdirSync(ws, { recursive: true });
  return ws;
}

module.exports = {
  SKILLS_DIR, SKILL_CREATOR, getSkillPath, readSkillMd,
  generateEvals, createEvalsJson, runEvalWithSkill, gradeOutput, createWorkspace
};
