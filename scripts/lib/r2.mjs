import { AwsClient } from 'aws4fetch'
import { createHash } from 'node:crypto'

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
    /**
     * 上传并校验（2026-11-16 新增，媒体事故根因之三）。
     * 历史事故：PUT 返回 200 但对象实际不存在（或字节不全）→ manifest 已写 → 线上破图
     * （malurus-cyaneus image-42..44、sphenopsis-ochracea image-50..53）。
     * 本方法在 PUT 后立刻 HEAD 回读，校验：状态 200 + 字节数一致 + ETag == 本地 md5。
     * 任一不符即抛错（不静默）。
     */
    async putVerified(key, body, contentType = 'application/octet-stream') {
      const buf = Buffer.isBuffer(body) ? body : Buffer.from(body)
      const localMd5 = createHash('md5').update(buf).digest('hex')
      await this.put(key, buf, contentType)
      const res = await client.fetch(`${endpoint}/${key}`, { method: 'HEAD' })
      if (res.status !== 200) {
        throw new Error(`R2 校验失败 ${key}：PUT 后 HEAD ${res.status}（对象不存在）`)
      }
      const remoteSize = Number(res.headers.get('content-length') || 0)
      const remoteEtag = (res.headers.get('etag') || '').replace(/"/g, '')
      if (remoteSize !== buf.length) {
        throw new Error(`R2 校验失败 ${key}：远端 ${remoteSize}B ≠ 本地 ${buf.length}B`)
      }
      // 单段上传的 ETag 即 md5；分片上传带 "-N" 后缀，跳过 md5 比对（大文件）
      if (remoteEtag && !remoteEtag.includes('-') && remoteEtag !== localMd5) {
        throw new Error(`R2 校验失败 ${key}：ETag ${remoteEtag.slice(0, 12)} ≠ 本地 md5 ${localMd5.slice(0, 12)}`)
      }
      return { key, size: remoteSize, etag: remoteEtag }
    },
    /** 对象是否存在（S3 HeadObject；仅 200 视为存在，其余当不存在） */
    async exists(key) {
      const res = await client.fetch(`${endpoint}/${key}`, { method: 'HEAD' })
      return res.status === 200
    },
  }
}
