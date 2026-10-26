import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useMediaGate } from '../useMediaGate'

describe('useMediaGate（媒体就绪门）', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('count=0 立即放行（听音题等 play 事件、或无需等媒体）', () => {
    const gate = useMediaGate()
    gate.reset(0)
    expect(gate.ready.value).toBe(true)
  })

  it('图片：load 到达即放行', () => {
    const gate = useMediaGate()
    gate.reset(1)
    expect(gate.ready.value).toBe(false)
    gate.markLoaded()
    expect(gate.ready.value).toBe(true)
    expect(gate.failed.value).toBe(0)
  })

  it('图片只是慢：1s 兜底放行，且不算失败', () => {
    const gate = useMediaGate()
    gate.reset(1)
    expect(gate.ready.value).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(gate.ready.value).toBe(true)
    expect(gate.failed.value).toBe(0)
  })

  it('一直不显示：兜底后 5s 才计入失败（既不 load 也不 error 的素材）', () => {
    const gate = useMediaGate()
    gate.reset(1)
    vi.advanceTimersByTime(1000)
    expect(gate.failed.value).toBe(0)
    vi.advanceTimersByTime(5000)
    expect(gate.failed.value).toBe(1)
  })

  it('兜底后 5s 内加载成功的，不会被误算成失败', () => {
    const gate = useMediaGate()
    gate.reset(1)
    vi.advanceTimersByTime(1000) // 兜底放行，看门狗启动
    gate.markLoaded() // 2s 时图出来了
    vi.advanceTimersByTime(5000)
    expect(gate.failed.value).toBe(0)
  })

  it('L6 六张选项图：全部有结果才放行', () => {
    const gate = useMediaGate()
    gate.reset(6)
    for (let i = 0; i < 5; i++) gate.markLoaded()
    expect(gate.ready.value).toBe(false)
    gate.markLoaded()
    expect(gate.ready.value).toBe(true)
  })

  it('失败比例达 1/3 才判定"建议重开"', () => {
    const gate = useMediaGate()
    gate.reset(6)
    gate.markLoaded()
    gate.markFailed()
    expect(gate.shouldPromptRetry.value).toBe(false) // 1/6
    gate.markFailed()
    expect(gate.shouldPromptRetry.value).toBe(true) // 2/6
  })

  it('切题 reset 会清掉上一题的计数', () => {
    const gate = useMediaGate()
    gate.reset(2)
    gate.markFailed()
    gate.reset(2)
    expect(gate.failed.value).toBe(0)
    expect(gate.ready.value).toBe(false)
  })

  it('听音逃生口：音频一直播不出来时，10s 后放行并计为失败', () => {
    const gate = useMediaGate()
    gate.reset(1, false) // 听音：不装 1s 兜底
    gate.armStall(10000)
    vi.advanceTimersByTime(9000)
    expect(gate.ready.value).toBe(false)
    vi.advanceTimersByTime(1000)
    expect(gate.ready.value).toBe(true)
    expect(gate.failed.value).toBe(1)
  })

  it('听音开播即放行，逃生口不再计失败', () => {
    const gate = useMediaGate()
    gate.reset(1, false)
    gate.armStall(10000)
    gate.release() // audio-play
    vi.advanceTimersByTime(20000)
    expect(gate.failed.value).toBe(0)
  })
})
