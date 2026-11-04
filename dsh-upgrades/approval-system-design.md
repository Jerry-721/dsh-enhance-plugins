# DSH 分级审批系统设计

## 现状分析

当前 DSH 的审批机制：
- **插件兼容性审批**：`desktop-main.js` 中的 `confirm(version, active)` 方法，用于插件安装/更新确认
- **更新审批**：`installDesktopUpdateTaskControl` 中的 lock/unlock 机制
- **quit-inspection**：退出前检查活跃任务

**缺失：**
1. 无 per-tool-call 级别的审批
2. 无文件读写操作的审批
3. 无命令执行的审批
4. 无权限变更的审批

## Codex 参考架构

Codex 的审批系统包含四个级别：

```rust
// 来自 Codex 的 approval schema
struct FileChangeRequestApproval {
    path: String,
    content: String,
    is_new_file: bool,
}

struct CommandExecutionRequestApproval {
    command: String,
    cwd: Option<String>,
}

struct PermissionsRequestApproval {
    permission: String,
    description: String,
}
```

## 设计方案

### 1. 审批类型枚举

```typescript
// approval-types.ts
export type ApprovalType = 
  | 'file_read'      // 读取文件（低风险，默认自动通过）
  | 'file_write'     // 写入/修改文件（中风险，需确认）
  | 'command_exec'   // 执行命令（高风险，需确认）
  | 'permission'     // 权限变更（极高风险，必须确认）
  | 'network'        // 网络请求（中风险，可配置）

export type ApprovalAction = 'approve' | 'deny' | 'approve_all' | 'deny_all';

export interface ApprovalRequest {
  id: string;              // 唯一请求 ID
  type: ApprovalType;
  target: string;          // 目标路径/命令
  description: string;     // 人类可读描述
  risk: 'low' | 'medium' | 'high' | 'critical';
  context: {
    sessionId: string;
    agentId: string;
    toolCall?: any;        // 原始 tool call
    workspace: string;
  };
  createdAt: number;
}

export interface ApprovalResponse {
  requestId: string;
  action: ApprovalAction;
  timestamp: number;
}
```

### 2. 审批策略引擎

```typescript
// approval-policy.ts
export interface ApprovalRule {
  id: string;
  pattern: string;         // glob 路径或命令前缀
  type: ApprovalType;
  action: 'auto-approve' | 'confirm' | 'deny';
  scope: 'workspace' | 'global';
}

export interface ApprovalPolicy {
  version: string;
  defaultAction: 'auto-approve' | 'confirm' | 'deny';
  rules: ApprovalRule[];
  sessionCache: Record<string, ApprovalAction[]>; // 会话级缓存
}

// 默认策略
const DEFAULT_POLICY: ApprovalPolicy = {
  version: '1.0.0',
  defaultAction: 'confirm',
  rules: [
    {
      id: 'read-any',
      pattern: '*',
      type: 'file_read',
      action: 'auto-approve',
      scope: 'global'
    },
    {
      id: 'write-safe',
      pattern: '*.md|*.txt|*.json|*.yml|*.yaml',
      type: 'file_write',
      action: 'auto-approve',
      scope: 'global'
    },
    {
      id: 'exec-read-only',
      pattern: 'ls|cat|head|tail|grep|find|which',
      type: 'command_exec',
      action: 'auto-approve',
      scope: 'global'
    },
    {
      id: 'exec-dangerous',
      pattern: 'rm -rf|sudo|chmod 777|mkfs',
      type: 'command_exec',
      action: 'deny',
      scope: 'global'
    }
  ],
  sessionCache: {}
};

function evaluatePolicy(policy: ApprovalPolicy, request: ApprovalRequest): 'auto-approve' | 'confirm' | 'deny' {
  // 1. 检查会话缓存
  const cached = policy.sessionCache[request.sessionId];
  if (cached && cached.includes(request.id)) {
    return cached[cached.length - 1] as 'auto-approve' | 'confirm' | 'deny';
  }
  
  // 2. 按规则匹配（从具体到通用）
  const matchingRules = policy.rules
    .filter(rule => matchesPattern(rule.pattern, request.target) && rule.type === request.type)
    .sort((a, b) => b.pattern.length - a.pattern.length); // 更具体的规则优先
  
  if (matchingRules.length > 0) {
    return matchingRules[0].action;
  }
  
  // 3. 返回默认策略
  return policy.defaultAction;
}
```

### 3. 审批中间件

```typescript
// approval-middleware.ts
import { Context, Service } from '@deepseek-ai/cordis';

export function installApprovalMiddleware(ctx: Context) {
  const policy = ctx.get('approvalPolicy') as ApprovalPolicy;
  
  // 拦截 tool calls
  ctx.on('agent/tool-call', async (event, next) => {
    const request: ApprovalRequest = {
      id: generateId(),
      type: classifyToolCall(event.toolName),
      target: event.args?.path || event.args?.command || 'unknown',
      description: `${event.toolName} on ${event.args?.path || 'command'}`,
      risk: classifyRisk(event.toolName),
      context: {
        sessionId: event.sessionId,
        agentId: event.agentId,
        toolCall: event,
        workspace: ctx.get('workspace')
      },
      createdAt: Date.now()
    };
    
    const action = evaluatePolicy(policy, request);
    
    if (action === 'auto-approve') {
      return next(); // 直接放行
    }
    
    if (action === 'deny') {
      throw new Error(`Approval denied: ${request.description}`);
    }
    
    // action === 'confirm'
    const response = await showApprovalDialog(request);
    if (response.action === 'deny') {
      throw new Error(`User denied: ${request.description}`);
    }
    
    // 缓存决策
    if (!policy.sessionCache[request.sessionId]) {
      policy.sessionCache[request.sessionId] = [];
    }
    policy.sessionCache[request.sessionId].push(request.id);
    
    return next();
  });
}

function classifyToolCall(toolName: string): ApprovalType {
  if (toolName === 'read' || toolName === 'grep') return 'file_read';
  if (toolName === 'edit' || toolName === 'write') return 'file_write';
  if (toolName === 'bash' || toolName === 'pwsh') return 'command_exec';
  if (toolName === 'agent_teams_*') return 'permission';
  return 'command_exec'; // 默认
}
```

### 4. GUI 审批面板

```typescript
// approval-panel.tsx
interface ApprovalPanelProps {
  request: ApprovalRequest;
  onApprove: (response: ApprovalResponse) => void;
  onDeny: (response: ApprovalResponse) => void;
}

function ApprovalPanel({ request, onApprove, onDeny }: ApprovalPanelProps) {
  return (
    <div className="ofm_panel">
      <div className="ofm_paneltitle">审批请求</div>
      <div className="ofm_row">
        <span>类型:</span>
        <span className="risk-badge risk-{request.risk}">
          {getRiskLabel(request.risk)}
        </span>
      </div>
      <div className="ofm_row">
        <span>操作:</span>
        <code>{request.target}</code>
      </div>
      <div className="ofm_row">
        <span>描述:</span>
        <span>{request.description}</span>
      </div>
      <div className="ofm_row">
        <button onClick={() => onApprove({ requestId: request.id, action: 'approve' })}>
          批准
        </button>
        <button onClick={() => onApprove({ requestId: request.id, action: 'approve_all' })}>
          批准全部
        </button>
        <button danger onClick={() => onDeny({ requestId: request.id, action: 'deny' })}>
          拒绝
        </button>
      </div>
    </div>
  );
}
```

### 5. 配置持久化

```yaml
# cordis.patch.yml 中添加
- id: approval-policy
  name: "@deepseek-ai/dsh-approval-policy"
  config:
    version: "1.0.0"
    defaultAction: confirm
    rules:
      - id: read-always
        pattern: "*"
        type: file_read
        action: auto-approve
      - id: write-markdown
        pattern: "*.md"
        type: file_write
        action: auto-approve
      - id: exec-safe
        pattern: "ls|cat|grep|find"
        type: command_exec
        action: auto-approve
      - id: deny-deadly
        pattern: "rm -rf /|sudo"
        type: command_exec
        action: deny
```

### 6. 会话级缓存

```typescript
// 同一次会话中，用户对同类操作的审批决定可以缓存
interface SessionCache {
  [sessionId: string]: {
    [requestId: string]: ApprovalAction;
    expiry: number; // 缓存过期时间
  };
}

// 缓存策略：同一会话、同一模式的操作，只问一次
function shouldCacheDecision(policy: ApprovalPolicy, request: ApprovalRequest): boolean {
  const sessionId = request.context.sessionId;
  const cache = policy.sessionCache[sessionId];
  
  if (!cache) return false;
  
  // 检查是否有匹配的已缓存决策
  for (const [cachedId, action] of Object.entries(cache)) {
    if (matchesPattern(request.target, cachedId) && action !== 'deny') {
      return true;
    }
  }
  
  return false;
}
```

## 实施步骤

1. **Phase 1**: 创建 `approval-types.ts` 和 `approval-policy.ts`
2. **Phase 2**: 实现 `approval-middleware.ts` 并集成到 cordis plugin 系统
3. **Phase 3**: 创建 GUI 审批面板组件
4. **Phase 4**: 添加配置持久化和会话缓存
5. **Phase 5**: 集成到桌面主进程 `desktop-main.js`

## 与现有代码的集成点

- `desktop-main.js:389533` - `confirm()` 方法可扩展为通用审批
- `desktop-main.js:395294` - `finishConfirmation(approved)` 可作为审批响应的基础
- `dsh-app-boot.js` - 在 profile 加载时初始化审批策略
