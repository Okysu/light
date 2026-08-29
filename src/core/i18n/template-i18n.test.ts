import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { baseParse, NodeTypes, type RootNode, type TemplateChildNode } from '@vue/compiler-dom'

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? vueFiles(path) : entry.name.endsWith('.vue') ? [path] : []
  })
}

describe('Vue 模板国际化边界', () => {
  it('不直接输出硬编码中文文本或中文属性', () => {
    const violations: string[] = []
    for (const file of vueFiles(join(process.cwd(), 'src'))) {
      const source = readFileSync(file, 'utf8')
      const start = source.indexOf('<template>')
      const end = source.lastIndexOf('</template>')
      const template = start >= 0 && end > start ? source.slice(start + '<template>'.length, end) : ''
      let root: RootNode
      try {
        root = baseParse(template, {
          isVoidTag: (tag) => ['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tag),
        })
      } catch (cause) {
        throw new Error(`无法解析 ${file}: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
      const visit = (node: RootNode | TemplateChildNode): void => {
        if (node.type === NodeTypes.TEXT && /[\p{Script=Han}]/u.test(node.content)) {
          violations.push(`${file}:${node.loc.start.line}: ${node.content.trim()}`)
        }
        if (node.type === NodeTypes.ELEMENT) {
          for (const prop of node.props) {
            if (prop.type === NodeTypes.ATTRIBUTE && prop.value && /[\p{Script=Han}]/u.test(prop.value.content)) {
              violations.push(`${file}:${prop.loc.start.line}: ${prop.name}="${prop.value.content}"`)
            }
          }
          node.children.forEach(visit)
        }
        if (node.type === NodeTypes.IF) node.branches.forEach((branch) => branch.children.forEach(visit))
        if (node.type === NodeTypes.FOR) node.children.forEach(visit)
      }
      root.children.forEach(visit)
    }
    expect(violations, violations.join('\n')).toEqual([])
  })
})
