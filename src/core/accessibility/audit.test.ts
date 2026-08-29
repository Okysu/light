// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { auditAccessibility } from './audit'

describe('无障碍静态审计', () => {
  it('报告无名称按钮、无 alt 图片、无标签输入与无名称对话框', () => {
    document.body.innerHTML = '<button><svg></svg></button><img><input><div role="dialog"></div>'
    expect(auditAccessibility(document).map((item) => item.rule)).toEqual([
      'button-name', 'image-alt', 'input-label', 'dialog-name',
    ])
  })

  it('接受 aria、title、label 和装饰图片空 alt', () => {
    document.body.innerHTML = '<button title="关闭"><svg></svg></button><img alt=""><label for="q">查询</label><input id="q"><div role="dialog" aria-label="设置"></div>'
    expect(auditAccessibility(document)).toEqual([])
  })
})
