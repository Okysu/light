interface HorizontalRect {
  left: number
  right: number
  top: number
}

interface ContainerRect {
  left: number
  top: number
}

/**
 * 把视口中的选区坐标换算成滚动容器内容区里的绝对坐标。
 *
 * `coordsAtPos` 与 `getBoundingClientRect` 都返回视口坐标，但工具条是滚动容器
 * 内的 absolute 元素。漏掉 scrollTop 后，文档滚得越远，工具条就越向上漂；
 * 图片、表格只是让这个问题更容易暴露，并不是需要分别处理的特殊节点。
 */
export function positionInScrollContainer(
  selection: HorizontalRect,
  container: ContainerRect,
  scrollLeft: number,
  scrollTop: number,
): { left: number; top: number } {
  return {
    left: (selection.left + selection.right) / 2 - container.left + scrollLeft,
    top: selection.top - container.top + scrollTop,
  }
}
