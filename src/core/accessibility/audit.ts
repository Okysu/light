export interface AccessibilityIssue {
  rule: 'button-name' | 'image-alt' | 'input-label' | 'dialog-name'
  element: Element
}

/**
 * Light 自己维护的轻量静态审计。它不替代屏幕阅读器实测，但能把最常见、
 * 也最容易在新增功能时回归的无名称控件挡在测试阶段。
 */
export function auditAccessibility(root: ParentNode): AccessibilityIssue[] {
  const issues: AccessibilityIssue[] = []
  const hasName = (element: Element): boolean => Boolean(
    element.getAttribute('aria-label')?.trim()
    || element.getAttribute('aria-labelledby')?.trim()
    || element.getAttribute('title')?.trim()
    || element.textContent?.trim(),
  )

  for (const element of root.querySelectorAll('button, [role="button"]')) {
    if (!hasName(element)) issues.push({ rule: 'button-name', element })
  }
  for (const element of root.querySelectorAll('img')) {
    if (!element.hasAttribute('alt')) issues.push({ rule: 'image-alt', element })
  }
  for (const element of root.querySelectorAll('input, textarea, select')) {
    const id = element.getAttribute('id')
    const labelled = hasName(element) || (id && root.querySelector(`label[for="${CSS.escape(id)}"]`))
    if (!labelled) issues.push({ rule: 'input-label', element })
  }
  for (const element of root.querySelectorAll('[role="dialog"]')) {
    if (!hasName(element)) issues.push({ rule: 'dialog-name', element })
  }
  return issues
}
