/**
 * DSH Canvas Plugin — /canvas
 *
 * 工作区内的轻量文稿面板：打开 / 保存 / 预览 / 列表。
 * 只依赖 node: 内建模块，Markdown → HTML 用极简正则实现。
 *
 * 用法：
 *   /canvas open <相对路径>             不存在则创建（内容 "# 标题"）
 *   /canvas save <相对路径> <内容>      写入并回显字节数
 *   /canvas preview <相对路径>          读取并渲染极简 HTML，返回前 1500 字符
 *   /canvas list                        列出 <cwd> 下一层 .md/.txt/.html（最多 30 个）
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';

export const name = 'dsh-canvas';
export const inject = ['commands'];

const PREVIEW_LIMIT = 1500;
const OPEN_PREVIEW_LIMIT = 400;
const LIST_LIMIT = 30;
const LIST_EXTS = new Set(['.md', '.txt', '.html']);

const DESCRIPTION = '工作区文稿的打开、保存与 Markdown 极简预览';
const USAGE = [
  '用法：',
  '  /canvas open <相对路径>            不存在则创建',
  '  /canvas save <相对路径> <内容>     写入文件',
  '  /canvas preview <相对路径>         渲染极简 HTML 预览',
  '  /canvas list                       列出当前目录的 .md/.txt/.html',
].join('\n');

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** 极简 Markdown → HTML：#/##/### 标题、**粗体**、`代码`、- 列表、换行 <br> */
function renderMarkdown(markdown) {
  let html = escapeHtml(markdown);
  html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/^[-*]\s+(.+)$/gm, '<li>$1</li>');
  html = html.replace(/\r\n/g, '\n').replace(/\n/g, '<br>');
  return html;
}

function truncate(text, limit) {
  const s = String(text ?? '');
  if (s.length <= limit) return { text: s, truncated: false, total: s.length };
  return { text: `${s.slice(0, limit)}\n… [已截断，共 ${s.length} 字符]`, truncated: true, total: s.length };
}

/** 把相对路径解析到 cwd 下，并给出相对 cwd 的展示路径 */
function resolveTarget(cwd, input) {
  const abs = resolve(cwd, input);
  return { abs, rel: relative(cwd, abs) || basename(abs) };
}

function openFile(cwd, argPath) {
  const { abs, rel } = resolveTarget(cwd, argPath);
  let created = false;

  if (!existsSync(abs)) {
    const parent = dirname(abs);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    const title = basename(abs, extname(abs)) || 'Untitled';
    writeFileSync(abs, `# ${title}\n`, 'utf8');
    created = true;
  }

  const stat = statSync(abs);
  if (stat.isDirectory()) {
    return { ok: false, text: `目标是一个目录，不是文件：${rel}` };
  }

  const content = readFileSync(abs, 'utf8');
  const preview = truncate(content, OPEN_PREVIEW_LIMIT);

  return {
    ok: true,
    text: [
      `${created ? '已创建并打开' : '已打开'}：${rel}`,
      `绝对路径：${abs}`,
      `字符数：${content.length}`,
      `预览（前 ${OPEN_PREVIEW_LIMIT} 字符）：`,
      preview.text || '(空文件)',
    ].join('\n'),
  };
}

function saveFile(cwd, argPath, content) {
  const { abs, rel } = resolveTarget(cwd, argPath);
  const parent = dirname(abs);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });

  writeFileSync(abs, content, 'utf8');
  const bytes = Buffer.byteLength(content, 'utf8');

  return {
    ok: true,
    text: [
      `已保存：${rel}`,
      `绝对路径：${abs}`,
      `写入字节数：${bytes} bytes`,
      `字符数：${content.length}`,
    ].join('\n'),
  };
}

function previewFile(cwd, argPath) {
  const { abs, rel } = resolveTarget(cwd, argPath);
  if (!existsSync(abs)) return { ok: false, text: `文件不存在：${rel}` };

  const stat = statSync(abs);
  if (stat.isDirectory()) return { ok: false, text: `目标是一个目录，不是文件：${rel}` };

  const markdown = readFileSync(abs, 'utf8');
  const html = renderMarkdown(markdown);
  const preview = truncate(html, PREVIEW_LIMIT);

  return {
    ok: true,
    text: [
      `预览：${rel}`,
      `源字符数：${markdown.length} · HTML 字符数：${html.length}`,
      '--- html ---',
      preview.text || '(空文件)',
    ].join('\n'),
  };
}

function listFiles(cwd) {
  let entries;
  try {
    entries = readdirSync(cwd, { withFileTypes: true });
  } catch (error) {
    return { ok: false, text: `无法读取目录 ${cwd}：${error instanceof Error ? error.message : String(error)}` };
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = extname(entry.name).toLowerCase();
    if (!LIST_EXTS.has(ext)) continue;
    const abs = join(cwd, entry.name);
    let size = 0;
    try {
      size = statSync(abs).size;
    } catch {
      size = 0;
    }
    files.push({ name: entry.name, size });
  }

  files.sort((a, b) => a.name.localeCompare(b.name));
  const shown = files.slice(0, LIST_LIMIT);

  const lines = [`目录：${cwd}`, `匹配文件：${files.length} 个（.md/.txt/.html，只列一层）`];
  if (!files.length) {
    lines.push('（没有匹配文件）');
  } else {
    for (const file of shown) lines.push(`  ${file.name}  (${file.size} bytes)`);
    if (files.length > shown.length) lines.push(`…… 另有 ${files.length - shown.length} 个未列出（上限 ${LIST_LIMIT}）`);
  }

  return { ok: true, text: lines.join('\n') };
}

/** 解析 "save <路径> <内容>" 形式的剩余文本 */
function splitPathAndContent(rest) {
  const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(rest.trim());
  if (!m) return { path: '', content: '' };
  return { path: m[1], content: m[2] ?? '' };
}

export function apply(ctx, config) {
  void config;

  ctx.effect(() => {
    const dispose = ctx.commands.register({
      name: 'canvas',
      description: DESCRIPTION,
      input: { hint: '<open|save|preview|list> [相对路径] [内容]' },
      handler(invocation) {
        const raw = String(invocation?.rawInput ?? '').trim();
        const cwd = process.cwd();

        if (!raw) return { kind: 'error', text: `缺少子命令。\n${USAGE}` };

        const m = /^(\S+)(?:\s+([\s\S]*))?$/.exec(raw);
        const sub = (m?.[1] ?? '').toLowerCase();
        const rest = (m?.[2] ?? '').trim();

        try {
          switch (sub) {
            case 'open': {
              if (!rest) return { kind: 'error', text: `缺少路径。用法：/canvas open <相对路径>` };
              const result = openFile(cwd, rest);
              return { kind: result.ok ? 'success' : 'error', text: result.text };
            }
            case 'save': {
              const { path: targetPath, content } = splitPathAndContent(rest);
              if (!targetPath) return { kind: 'error', text: '缺少路径。用法：/canvas save <相对路径> <内容>' };
              if (!content) return { kind: 'error', text: '缺少内容。用法：/canvas save <相对路径> <内容>' };
              const result = saveFile(cwd, targetPath, content);
              return { kind: result.ok ? 'success' : 'error', text: result.text };
            }
            case 'preview': {
              if (!rest) return { kind: 'error', text: '缺少路径。用法：/canvas preview <相对路径>' };
              const result = previewFile(cwd, rest);
              return { kind: result.ok ? 'success' : 'error', text: result.text };
            }
            case 'list': {
              const result = listFiles(cwd);
              return { kind: result.ok ? 'success' : 'error', text: result.text };
            }
            default:
              return { kind: 'error', text: `未知子命令 "${sub}"。\n${USAGE}` };
          }
        } catch (error) {
          return {
            kind: 'error',
            text: `canvas 执行失败：${error instanceof Error ? error.message : String(error)}`,
          };
        }
      },
    });

    return () => {
      dispose?.();
    };
  });
}
