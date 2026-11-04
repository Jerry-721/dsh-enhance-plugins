# DSH Skills 结构化升级方案

## 现状分析

当前 DSH 的 skill 系统：
- 7 个 SKILL.md 文件存储在 `D:\dsh\resources\runtime\office-skills\`
- 每个 SKILL.md 顶部有 YAML frontmatter（name, description）
- 通过 `ctx.plugin(officeSkills)` 在 `dsh-desktop-host-index.js` 中加载
- Agent 通过 prompt 知道要调用 `skill` 工具来加载技能

**问题：**
1. 无结构化元数据（trigger 条件、依赖 tool、组合关系）
2. 无自动路由（agent 必须"知道"何时加载哪个 skill）
3. 无版本管理 / schema 校验
4. 无 skill 间组合（composite skill 需要手动加载多个）

## 设计方案

### 1. Skill Manifest Schema (JSON)

```json
{
  "schemaVersion": "1.0.0",
  "skills": {
    "office-docx": {
      "name": "office-docx",
      "description": "Create, read, edit, and validate Word documents (.docx).",
      "trigger": ["docx", "word", "文档", "创建word"],
      "toolDeps": ["bash", "read", "edit", "write", "present"],
      "requiresPythonLibs": ["python-docx"],
      "composite": false,
      "parentSkill": null,
      "subSkills": [],
      "priority": 10,
      "category": "office",
      "loadOrder": 1
    },
    "office-pptx": {
      "name": "office-pptx",
      "description": "Create, read, edit, and validate PowerPoint presentations (.pptx).",
      "trigger": ["pptx", "powerpoint", "演示文稿", "幻灯片"],
      "toolDeps": ["bash", "read", "edit", "write", "present"],
      "requiresPythonLibs": ["python-pptx"],
      "composite": false,
      "parentSkill": null,
      "subSkills": [],
      "priority": 10,
      "category": "office",
      "loadOrder": 2
    },
    "office-xlsx": {
      "name": "office-xlsx",
      "description": "Read, create, edit, and validate Excel workbooks (.xlsx).",
      "trigger": ["xlsx", "excel", "表格", "工作簿"],
      "toolDeps": ["bash", "read", "edit", "write", "present"],
      "requiresPythonLibs": ["openpyxl", "pandas"],
      "composite": false,
      "parentSkill": null,
      "subSkills": [],
      "priority": 10,
      "category": "office",
      "loadOrder": 3
    },
    "office-render": {
      "name": "office-render",
      "description": "Render document images and visual inspection with LibreOffice Kit.",
      "trigger": ["render", "预览", "图片", "视觉", "layout", "spacing"],
      "toolDeps": ["bash"],
      "requiresBinaries": ["libreoffice-kit"],
      "composite": false,
      "parentSkill": "office",
      "subSkills": [],
      "priority": 5,
      "category": "office",
      "loadOrder": 4
    },
    "office-export-pdf": {
      "name": "office-export-pdf",
      "description": "Convert Office documents to PDF with LibreOffice Kit.",
      "trigger": ["pdf", "导出", "conversion"],
      "toolDeps": ["bash"],
      "requiresBinaries": ["libreoffice-kit"],
      "composite": false,
      "parentSkill": "office",
      "subSkills": [],
      "priority": 5,
      "category": "office",
      "loadOrder": 5
    },
    "office-recalculate": {
      "name": "office-recalculate",
      "description": "Refresh spreadsheet formula caches with LibreOffice Kit.",
      "trigger": ["recalculate", "公式", "计算", "刷新"],
      "toolDeps": ["bash"],
      "requiresBinaries": ["libreoffice-kit"],
      "composite": false,
      "parentSkill": "office",
      "subSkills": [],
      "priority": 5,
      "category": "office",
      "loadOrder": 6
    },
    "office": {
      "name": "office",
      "description": "Create, edit, inspect, or convert Office documents, spreadsheets, presentations, and PDFs.",
      "trigger": ["office", "word", "excel", "ppt", "文档", "演示", "表格"],
      "toolDeps": [],
      "composite": true,
      "parentSkill": null,
      "subSkills": ["office-docx", "office-pptx", "office-xlsx", "office-render", "office-export-pdf", "office-recalculate"],
      "priority": 1,
      "category": "office",
      "loadOrder": 0
    }
  }
}
```

### 2. 自动路由逻辑

```javascript
// skill-router.js
function matchSkill(query, manifest) {
  const matches = [];
  for (const [id, skill] of Object.entries(manifest.skills)) {
    // 检查 trigger 关键词匹配
    const queryLower = query.toLowerCase();
    const triggerMatch = skill.trigger.some(t => 
      queryLower.includes(t.toLowerCase())
    );
    
    if (triggerMatch) {
      matches.push({ id, skill, score: skill.priority });
    }
  }
  
  // 按优先级排序
  matches.sort((a, b) => b.score - a.score);
  return matches;
}

function getCompositeSkills(compositeId, manifest) {
  const composite = manifest.skills[compositeId];
  if (!composite || !composite.composite) return [];
  
  const results = [compositeId];
  for (const subId of composite.subSkills) {
    results.push(...getCompositeSkills(subId, manifest));
  }
  return [...new Set(results)];
}
```

### 3. 集成点

在 `dsh-desktop-host-index.js` 的 `apply()` 函数中，加载 manifest 并注册到 ctx：

```javascript
// 在 office plugin 加载后，注册 skill manifest
ctx.provide('skillManifest', async () => {
  const manifestPath = join(config.assetRoot, 'manifest.json');
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
});
```

### 4. 兼容性

- SKILL.md 文件继续作为 skill 内容源
- manifest.json 只添加元数据层
- 旧版 SKILL.md 文件可自动生成 manifest entry
