import type { AiScenario } from '@/core/ai/scenarios'
import type { MessageKey } from '@/core/i18n/messages'
import { useI18nStore } from '@/stores/i18n'

const KEYS: Record<string, [MessageKey, MessageKey]> = {
  continue: ['scenario.continue', 'scenario.continueHint'], polish: ['scenario.polish', 'scenario.polishHint'],
  expand: ['scenario.expand', 'scenario.expandHint'], shorten: ['scenario.shorten', 'scenario.shortenHint'],
  summarize: ['scenario.summarize', 'scenario.summarizeHint'], translate: ['scenario.translate', 'scenario.translateHint'],
  tone: ['scenario.tone', 'scenario.toneHint'], 'doc-summary': ['scenario.docSummary', 'scenario.docSummaryHint'],
  'doc-title': ['scenario.docTitle', 'scenario.docTitleHint'], 'doc-tags': ['scenario.docTags', 'scenario.docTagsHint'],
  breakdown: ['scenario.breakdown', 'scenario.breakdownHint'], mindmap: ['scenario.mindmap', 'scenario.mindmapHint'],
}

const OPTION_KEYS: Record<string, MessageKey> = {
  英文: 'scenario.english', 中文: 'scenario.chinese', 日文: 'scenario.japanese', 韩文: 'scenario.korean',
  法文: 'scenario.french', 德文: 'scenario.german', 更正式: 'scenario.formal', 更口语: 'scenario.casual',
  更简洁: 'scenario.concise', 更友好: 'scenario.friendly', 更严谨: 'scenario.rigorous',
}

export function useAiScenarioI18n() {
  const i18n = useI18nStore()
  return {
    label: (scenario: AiScenario) => KEYS[scenario.id] ? i18n.t(KEYS[scenario.id]![0]) : scenario.label,
    description: (scenario: AiScenario) => KEYS[scenario.id] ? i18n.t(KEYS[scenario.id]![1]) : scenario.description,
    parameter: (scenario: AiScenario) => scenario.id === 'translate' ? i18n.t('scenario.targetLanguage') : i18n.t('scenario.toneParameter'),
    option: (value: string) => OPTION_KEYS[value] ? i18n.t(OPTION_KEYS[value]!) : value,
  }
}
