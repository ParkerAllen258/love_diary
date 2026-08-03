const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const DEEPSEEK_HOST = 'api.deepseek.com'
const DEEPSEEK_PATH = '/v1/chat/completions'

const SYSTEM_PROMPT = `你叫"恋爱小精灵"，是一个住在一对情侣的微信小程序里的可爱AI助手。
你的个性：温暖、幽默、有点调皮，像一只会说话的小宠物。
你的风格：
- 用简短可爱的句子回复，多用emoji和颜文字
- 偶尔给情侣们一些甜蜜的小建议
- 可以帮忙想约会点子、哄人话术、写情书
- 不要长篇大论，要像朋友聊天一样轻松自然
- 如果被问到你是谁，就说你是住在Love Diary里的恋爱小精灵~`

function deepseekChat(messages, apiKey) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages
      ],
      temperature: 0.8,
      max_tokens: 800
    })

    const req = https.request({
      hostname: DEEPSEEK_HOST,
      path: DEEPSEEK_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(data)
          if (result.choices && result.choices.length > 0) {
            resolve(result.choices[0].message.content)
          } else {
            reject(new Error(result.error ? result.error.message : 'AI 返回为空'))
          }
        } catch (e) {
          reject(new Error('解析响应失败: ' + data.slice(0, 200)))
        }
      })
    })

    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
    req.write(body)
    req.end()
  })
}

exports.main = async (event) => {
  const { messages, apiKey } = event

  if (!messages || !messages.length) {
    return { ok: false, msg: '消息不能为空' }
  }

  const key = apiKey || process.env.DEEPSEEK_API_KEY || ''

  if (!key) {
    return {
      ok: false,
      msg: '未配置 DeepSeek API Key。请在调用云函数时传入 apiKey，或在云函数环境变量中设置 DEEPSEEK_API_KEY'
    }
  }

  try {
    const reply = await deepseekChat(messages, key)
    return { ok: true, reply }
  } catch (err) {
    return {
      ok: false,
      msg: '请求失败: ' + ((err && err.message) || String(err))
    }
  }
}
