# auto-improver (aim)

自动测试、评估和改进 Claude Code Skills 的命令行工具。基于 skill-creator 框架，运行完整的 测试 → 评估 → 改进 → 重复 循环。

## 安装

```bash
git clone https://github.com/Twistzzzzzzzzzzzzzzzzz/auto-improver.git ~/.claude/tools/auto-improver
```

添加到 PATH：

```bash
# PowerShell
Add-Content $PROFILE "`n`$env:PATH += `";$env:USERPROFILE\.claude\tools\auto-improver\bin`""

# Git Bash
echo 'export PATH="$HOME/.claude/tools/auto-improver/bin:$PATH"' >> ~/.bashrc
```

## 使用

```bash
aim <command> [skill-name] [options]
```

### 命令

| 命令 | 说明 |
|------|------|
| `improve [name]` | 运行完整改进循环 |
| `quick [name]` | 快速生成改进建议（不自动应用） |
| `test [name]` | 仅运行测试 |
| `push [name]` | 提交并推送改进 |
| `status [name]` | 查看 skill 状态 |

### 示例

```bash
# 改进 image-analyzer（默认 3 轮迭代）
aim improve image-analyzer

# 5 轮迭代 + 自动推送
GITHUB_TOKEN=ghp_xxx aim improve image-analyzer --iterations 5 --auto-push

# 快速检查质量
aim quick image-analyzer

# 仅跑测试
aim test frontend-design

# 查看状态
aim status image-analyzer
```

### 改进循环流程

```
┌─────────────────────────────────────────┐
│  Iteration 1                            │
│  ┌──────┐   ┌──────┐   ┌────────────┐  │
│  │ Test │ → │Grade │ → │  Improve   │  │
│  │7 evals│  │ 0-100%│  │AI suggests │  │
│  └──────┘   └──────┘   └─────┬──────┘  │
│                              │          │
│                    Apply → Repeat      │
│                    improvements         │
└─────────────────────────────────────────┘
         ↓
   Iteration 2 ... (until all pass or max iterations)
         ↓
   Report summary + optional auto-push
```

### 测试用例

`aim` 为 image-analyzer 预设了 7 个测试用例：

| # | 场景 | 提示词示例 |
|---|------|-----------|
| 1 | 截图分析 | "看看这张程序报错的截图，帮我分析" |
| 2 | UI 审查 | "review 这个登录页面设计" |
| 3 | 图表解读 | "这个季度销售数据的折线图说明了什么" |
| 4 | OCR 提取 | "提取这张菜单图片里的所有文字" |
| 5 | 照片描述 | "描述一下这张照片里有什么" |
| 6 | 对比分析 | "对比这两张改版前后的截图" |
| 7 | 简短模式 | "quick - 快速看下这张图" |

### 评估标准

每个测试输出按以下维度打分：

- 结构化输出（是否使用模板）
- 表格使用（数据是否表格化）
- 中文输出（分析用中文）
- 内容长度（是否足够详细）
- 非空输出（是否正常执行）

## 依赖

- Node.js >= 18
- Claude Code CLI (`claude`)
- skill-creator skill（用于 eval 框架）

## License

MIT
