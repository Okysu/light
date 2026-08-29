import { beforeEach, describe, expect, it } from 'vitest'
import { MemoryAdapter } from '../storage/memory-adapter'
import { BoardService } from './board-service'
import { createCard, createEmptyBoard } from './types'

let counter = 0
const nextId = (): string => `id-${++counter}`

describe('BoardService', () => {
  let fs: MemoryAdapter
  let service: BoardService

  beforeEach(() => {
    counter = 0
    fs = new MemoryAdapter()
    service = new BoardService(fs, nextId)
  })

  describe('读写往返', () => {
    it('写进去什么读出来就是什么', async () => {
      const board = createEmptyBoard(nextId)
      board.columns[0]!.cards.push(createCard(nextId, '第一张卡'))

      await service.write('看板.board', board)
      expect(await service.read('看板.board')).toEqual(board)
    })

    it('落盘的是可读的 JSON，用户能直接打开看', async () => {
      await service.write('看板.board', createEmptyBoard(nextId))
      const raw = await fs.readText('看板.board')

      expect(raw).toContain('\n  ')
      expect(JSON.parse(raw).kind).toBe('board')
    })
  })

  /**
   * 看板打不开比少一个字段严重得多。
   * 文件可能被用户手工改过、被旧版本写过、或者干脆坏了，
   * 这一组锁住「无论输入多糟，都要还给界面一份能渲染的看板」。
   */
  describe('归一化', () => {
    it('文件不存在时给出默认三列', async () => {
      const board = await service.read('不存在.board')
      expect(board.columns.map((c) => c.title)).toEqual(['待办', '进行中', '已完成'])
    })

    it('JSON 损坏时不抛错', async () => {
      await fs.writeText('坏的.board', '{ 这不是 JSON')
      expect((await service.read('坏的.board')).columns.length).toBeGreaterThan(0)
    })

    it('空 columns 退回默认三列——一列都没有的看板没法用', () => {
      expect(service.normalize({ version: 1, kind: 'board', columns: [] }).columns).toHaveLength(3)
    })

    it('缺字段的卡片被补齐，标题保住', () => {
      const board = service.normalize({
        columns: [{ id: 'c1', title: '待办', cards: [{ title: '只有标题' }] }],
      })
      expect(board.columns[0]?.cards[0]).toMatchObject({
        title: '只有标题',
        description: '',
        tags: [],
        priority: 'normal',
        archived: false,
      })
      expect(board.columns[0]?.cards[0]?.id).toBeTruthy()
    })

    it('类型不对的字段被换成默认值而不是原样带进来', () => {
      const board = service.normalize({
        columns: [
          {
            id: 'c1',
            title: '待办',
            cards: [{ id: 'a', title: 123, tags: 'not-an-array', priority: '超高', archived: 'yes' }],
          },
        ],
      })
      const card = board.columns[0]?.cards[0]
      expect(card).toMatchObject({ title: '', tags: [], priority: 'normal', archived: false })
    })

    it('标签数组里的非字符串被剔除', () => {
      const board = service.normalize({
        columns: [{ id: 'c1', title: 'x', cards: [{ id: 'a', tags: ['工作', 42, null] }] }],
      })
      expect(board.columns[0]?.cards[0]?.tags).toEqual(['工作'])
    })

    it('缺 id 的列与卡片会补上，否则拖拽无从定位', () => {
      const board = service.normalize({ columns: [{ title: '待办', cards: [{ title: '卡' }] }] })
      expect(board.columns[0]?.id).toBeTruthy()
      expect(board.columns[0]?.cards[0]?.id).toBeTruthy()
    })

    it('null 与非对象输入都能兜住', () => {
      for (const input of [null, undefined, 42, 'string', []]) {
        expect(service.normalize(input).columns.length).toBeGreaterThan(0)
      }
    })

    it('清单项被逐条归一化', () => {
      const board = service.normalize({
        columns: [
          { id: 'c1', title: 'x', cards: [{ id: 'a', checklist: [{ text: '子任务' }, 'bad', null] }] },
        ],
      })
      const checklist = board.columns[0]?.cards[0]?.checklist
      expect(checklist).toHaveLength(1)
      expect(checklist?.[0]).toMatchObject({ text: '子任务', done: false })
    })

    it('归一化后的看板再次归一化不再变化', () => {
      const once = service.normalize({ columns: [{ title: '待办', cards: [{ title: '卡' }] }] })
      expect(service.normalize(once as unknown)).toEqual(once)
    })
  })
})
