/**
 * DSH Approval System - 分级审批引擎
 * 
 * 参考 Codex 的 approval schema:
 * - FileChangeRequestApproval
 * - CommandExecutionRequestApproval  
 * - PermissionsRequestApproval
 */

export type ApprovalType = 
  | 'file_read'      // 读取文件（低风险，默认自动通过）
  | 'file_write'     // 写入/修改文件（中风险，需确认）
  | 'command_exec'   // 执行命令（高风险，需确认）
  | 'permission'     // 权限变更（极高风险，必须确认）
  | 'network'        // 网络请求（中风险，可配置）
  | 'agent_spawn';   // 启动子代理（中风险）

export type ApprovalAction = 'approve' | 'deny' | 'approve_all' | 'deny_all';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export interface ApprovalRequest {
  id: string;
  type: ApprovalType;
  target: string;
  description: string;
  risk: RiskLevel;
  context: {
    sessionId: string;
    agentId: string;
    toolCall?: any;
    workspace: string;
  };
  createdAt: number;
  expiresAt?: number;
}

export interface ApprovalResponse {
  requestId: string;
  action: ApprovalAction;
  timestamp: number;
  reason?: string;
}

export interface ApprovalRule {
  id: string;
  pattern: string;
  type: ApprovalType;
  action: 'auto-approve' | 'confirm' | 'deny';
  scope: 'workspace' | 'global';
  description?: string;
}

export interface ApprovalPolicy {
  version: string;
  defaultAction: 'auto-approve' | 'confirm' | 'deny';
  rules: ApprovalRule[];
  sessionCache: Record<string, ApprovalDecision[]>;
  globalCache: ApprovalDecision[];
}

export interface ApprovalDecision {
  requestId: string;
  action: ApprovalAction;
  timestamp: number;
  pattern: string;
}

/**
 * 默认审批策略
 */
export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  version: '1.0.0',
  defaultAction: 'confirm',
  rules: [
    // 文件读取 - 总是自动批准
    {
      id: 'read-any',
      pattern: '*',
      type: 'file_read',
      action: 'auto-approve',
      scope: 'global',
      description: '所有文件读取操作自动批准'
    },
    // 只读命令 - 自动批准
    {
      id: 'exec-read-only',
      pattern: '^(ls|cat|head|tail|grep|find|which|echo|pwd|type|dir|Get-Content|Get-ChildItem)',
      type: 'command_exec',
      action: 'auto-approve',
      scope: 'global',
      description: '只读命令自动批准'
    },
    // 危险命令 - 拒绝
    {
      id: 'exec-dangerous',
      pattern: '^(rm\\s+-rf|sudo\\s+rm|chmod\\s+777|mkfs|dd\\s+/dev/|wget\\s+.*\\|\\s*sh|curl.*\\|\\s*sh)',
      type: 'command_exec',
      action: 'deny',
      scope: 'global',
      description: '危险命令直接拒绝'
    },
    // Markdown/TXT 写入 - 自动批准
    {
      id: 'write-docs',
      pattern: '\\.(md|txt|json|yml|yaml)$',
      type: 'file_write',
      action: 'auto-approve',
      scope: 'global',
      description: '文档类文件写入自动批准'
    },
    // 源代码写入 - 需要确认
    {
      id: 'write-source',
      pattern: '\\.(js|ts|jsx|tsx|py|go|rs|c|cpp|h|hpp)$',
      type: 'file_write',
      action: 'confirm',
      scope: 'global',
      description: '源代码修改需要确认'
    },
    // 删除操作 - 需要确认
    {
      id: 'delete-any',
      pattern: '^rm\\s+',
      type: 'command_exec',
      action: 'confirm',
      scope: 'global',
      description: '文件删除需要确认'
    }
  ],
  sessionCache: {},
  globalCache: []
};

/**
 * 评估审批策略
 */
export function evaluatePolicy(
  policy: ApprovalPolicy,
  request: ApprovalRequest
): 'auto-approve' | 'confirm' | 'deny' {
  // 1. 检查会话缓存
  const cached = policy.sessionCache[request.context.sessionId];
  if (cached) {
    const lastDecision = cached[cached.length - 1];
    if (lastDecision && matchesPattern(lastDecision.pattern, request.target)) {
      return lastDecision.action === 'approve' || lastDecision.action === 'approve_all' 
        ? 'auto-approve' 
        : 'deny';
    }
  }
  
  // 2. 检查全局缓存
  for (const decision of policy.globalCache) {
    if (matchesPattern(decision.pattern, request.target) && decision.action !== 'deny') {
      return 'auto-approve';
    }
  }
  
  // 3. 按规则匹配（从具体到通用）
  const matchingRules = policy.rules
    .filter(rule => 
      rule.type === request.type && matchesPattern(rule.pattern, request.target)
    )
    .sort((a, b) => b.pattern.length - a.pattern.length);
  
  if (matchingRules.length > 0) {
    const action = matchingRules[0].action;
    // 更新全局缓存
    policy.globalCache.push({
      requestId: request.id,
      action: action === 'confirm' ? 'approve' : action,
      timestamp: Date.now(),
      pattern: matchingRules[0].pattern
    });
    return action;
  }
  
  // 4. 返回默认策略
  return policy.defaultAction;
}

/**
 * 匹配 glob 模式
 */
export function matchesPattern(pattern: string, target: string): boolean {
  // 简化实现：支持 * 和 ? 通配符
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  const regex = new RegExp(`^${regexPattern}$`, 'i');
  return regex.test(target);
}

/**
 * 分类 tool call
 */
export function classifyToolCall(toolName: string, args?: any): ApprovalType {
  if (!toolName) return 'command_exec';
  
  const lowerName = toolName.toLowerCase();
  
  // 文件操作
  if (['read', 'write', 'edit', 'glob', 'grep', 'sed', 'awk'].includes(lowerName)) {
    return 'file_read';
  }
  
  // 命令执行
  if (['bash', 'pwsh', 'win_bash', 'exec', 'run'].includes(lowerName)) {
    return 'command_exec';
  }
  
  // 权限相关
  if (toolName.startsWith('agent_teams_') || lowerName.includes('permission')) {
    return 'permission';
  }
  
  // Agent 相关
  if (lowerName.includes('agent') || lowerName.includes('spawn')) {
    return 'agent_spawn';
  }
  
  return 'command_exec';
}

/**
 * 分类风险级别
 */
export function classifyRisk(toolName: string, args?: any): RiskLevel {
  if (!toolName) return 'medium';
  
  const lowerName = toolName.toLowerCase();
  
  // 危险命令
  if (lowerName.includes('rm') || lowerName.includes('delete') || lowerName.includes('kill')) {
    return 'high';
  }
  
  // 写操作
  if (['write', 'edit', 'create'].includes(lowerName)) {
    return 'medium';
  }
  
  // 读操作
  if (['read', 'grep', 'glob'].includes(lowerName)) {
    return 'low';
  }
  
  // Agent 操作
  if (lowerName.includes('agent') || lowerName.includes('team')) {
    return 'medium';
  }
  
  return 'medium';
}

/**
 * 生成唯一请求 ID
 */
export function generateApprovalId(): string {
  return `approval-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * 格式化审批请求为人类可读描述
 */
export function formatApprovalRequest(request: ApprovalRequest): string {
  const riskLabel = {
    low: '🟢 低',
    medium: '🟡 中', 
    high: '🟠 高',
    critical: '🔴 危险'
  }[request.risk];
  
  return `【${riskLabel}风险】${request.description}\n目标: ${request.target}`;
}
