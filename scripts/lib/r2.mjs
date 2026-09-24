import { AwsClient } from 'aws4fetch'

/**
 * Cloudflare R2 的 S3 兼容客户端（轻量，无原生依赖）。
 * 需要环境变量：R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET
 * 公开访问地址：R2_PUBLIC_BASE（自定义域名或 r2.dev）
 */
export function makeR2(env = process.env) {
  const accountId = env.R2_ACCOUNT_ID
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  const bucket = env.R2_BUCKET
  let publicBase = (env.R2_PUBLIC_BASE || '').replace(/\/$/, '')
  if (publicBase && !/^https?:\/\//i.test(publicBase)) publicBase = 'https://' + publicBase

  const missing = []
  if (!accountId) missing.push('R2_ACCOUNT_ID')
  if (!accessKeyId) missing.push('R2_ACCESS_KEY_ID')
  if (!secretAccessKey) missing.push('R2_SECRET_ACCESS_KEY')
  if (!bucket) missing.push('R2_BUCKET')
  if (!publicBase) missing.push('R2_PUBLIC_BASE')

  if (missing.length) {
    return {
      ready: false,
      missing,
      publicBase,
      async put() {
        throw new Error('R2 未配置：缺少 ' + missing.join(', '))
      },
    }
  }

  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: 's3',
    region: 'auto',
  })
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com/${bucket}`

  return {
    ready: true,
    missing: [],
    publicBase,
    async put(key, body, contentType = 'application/octet-stream') {
      const res = await client.fetch(`${endpoint}/${key}`, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': contentType },
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`R2 PUT ${key} → ${res.status} ${text.slice(0, 200)}`)
      }
    },
  }
}
