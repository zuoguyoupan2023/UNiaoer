import { config } from '@vue/test-utils'
import { i18n } from './src/i18n'

// 组件测试统一安装 i18n 插件，并固定为中文（jsdom 默认 navigator.language=en-US）
i18n.global.locale.value = 'zh-CN'
config.global.plugins = [i18n]
