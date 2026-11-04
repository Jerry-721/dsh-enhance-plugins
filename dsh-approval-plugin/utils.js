/**
 * 模式匹配工具
 */

/**
 * 简单的 glob 模式匹配
 * 支持 * 和 ? 通配符
 */
export function matchesPattern(pattern, target) {
  if (pattern === '*') return true;
  
  // 转义正则特殊字符
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  
  const regex = new RegExp(`^${escaped}$`, 'i');
  return regex.test(target);
}

/**
 * 扩展的 glob 匹配（支持 {} 花括号）
 */
export function globMatch(pattern, target) {
  if (pattern.includes('{')) {
    // 处理 {a,b,c} 模式
    const match = pattern.match(/^([^{}]*)\{([^}]+)\}(.*)$/);
    if (match) {
      const [, prefix, options, suffix] = match;
      const parts = options.split(',');
      return parts.some(opt => 
        globMatch(prefix + opt + suffix, target)
      );
    }
  }
  
  return matchesPattern(pattern, target);
}
