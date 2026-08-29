/**
 * 测试环境的浏览器 API 补齐。
 *
 * jsdom 只实现了 DOM 的一部分，而 Milkdown 的官方组件（代码块的懒渲染、
 * 表格的尺寸跟随）依赖 IntersectionObserver / ResizeObserver。
 * 缺失时组件构造直接抛错，会把无关的往返测试一并拖垮。
 *
 * 这里只做「存在且不报错」的最小实现——测试断言的是文档结构与序列化结果，
 * 不依赖真实的可见性或尺寸回调。若将来要测懒加载行为，需要换成可手动触发的版本。
 */

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return []
  }
}

if (!('IntersectionObserver' in globalThis)) {
  Reflect.set(globalThis, 'IntersectionObserver', NoopObserver)
}

if (!('ResizeObserver' in globalThis)) {
  Reflect.set(globalThis, 'ResizeObserver', NoopObserver)
}

// KaTeX 在渲染时会读取字体度量，jsdom 下 getBoundingClientRect 恒为 0，
// 这不影响我们对节点结构与序列化结果的断言。
