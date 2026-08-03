const CHAT_STORAGE_KEY = 'spriteChatHistory'
const DEFAULT_GREETING = '你好呀，我是恋爱小精灵 ✨ 有什么想聊的吗？'

Page({
  data: {
    text: '',
    list: [
      { type: 'ai', content: DEFAULT_GREETING }
    ],
    loading: false,
    scrollToView: 'msg-0'
  },

  onLoad() {
    // 加载历史聊天记录
    this.loadChatHistory()
  },

  // 加载本地存储的聊天记录
  loadChatHistory() {
    try {
      const saved = wx.getStorageSync(CHAT_STORAGE_KEY)
      if (saved && Array.isArray(saved) && saved.length > 0) {
        // 确保没有 loading 状态的残留
        const cleaned = saved.map(item => {
          if (item.loading) {
            return { type: item.type, content: item.content || '...' }
          }
          return item
        })
        this.setData({ list: cleaned, scrollToView: 'msg-' + (cleaned.length - 1) })
      }
    } catch (e) {
      // 解析失败则使用默认
    }
  },

  // 保存聊天记录到本地存储
  saveChatHistory() {
    try {
      const list = this.data.list
      // 限制最多保存 100 条消息，避免存储过大
      const toSave = list.length > 100 ? list.slice(list.length - 100) : list
      // 检查序列化后大小，避免超出 Storage 单 key 上限（约 1MB）
      const serialized = JSON.stringify(toSave)
      if (serialized.length > 500 * 1024) {
        console.warn('Chat history too large, truncating to 50 messages')
        const half = list.length > 50 ? list.slice(list.length - 50) : list.slice(0, 50)
        wx.setStorageSync(CHAT_STORAGE_KEY, half)
        return
      }
      wx.setStorageSync(CHAT_STORAGE_KEY, toSave)
    } catch (e) {
      // 存储失败静默处理
    }
  },

  onInput(e) {
    this.setData({ text: e.detail.value })
  },

  send() {
    const text = this.data.text.trim()
    if (!text || this.data.loading) return

    const userMsg = { type: 'user', content: text }
    const list = [...this.data.list, userMsg, { type: 'ai', content: '...', loading: true }]

    this.setData({
      list,
      text: '',
      loading: true,
      scrollToView: 'msg-' + (list.length - 1)
    })

    // 保存用户消息
    this.saveChatHistory()

    this.callLocalAI(text)
  },

  // ==================== 本地智能对话 ====================

  callLocalAI(userText) {
    // 模拟延迟，更像真人在打字
    const delay = 600 + Math.random() * 800
    setTimeout(() => {
      const reply = this.generateLocalReply(userText)
      this.updateLastAi(reply)
      this.setData({ loading: false })
    }, delay)
  },

  generateLocalReply(text) {
    const t = text.toLowerCase().trim()

    // === 问候 ===
    if (/^(你好|hi|hello|嗨|halo|嘿|在吗|在不在)/.test(t)) {
      return this.pick([
        '你好呀~ 💕 今天心情怎么样呀？',
        '嗨！我在呢 ✨ 有什么想聊的吗？',
        '嘿嘿，你来啦！我等你好久了呢 🥰',
        '在在在！小精灵随时在线哦 🌟',
        '你好呀~ 今天和TA甜甜蜜蜜了吗？😊'
      ])
    }

    // === 你是谁 ===
    if (/(你是谁|你叫什么|你的名字|自我介绍|what are you)/.test(t)) {
      return '我是住在Love Diary里的恋爱小精灵呀~ 🤖💕 我的工作是陪你们聊天、给你们出主意，让你们的恋爱甜甜的！有什么想问的尽管说哦~'
    }

    // === 约会建议 ===
    if (/(约会|去哪玩|去哪吃|去哪|见面|怎么玩|玩什么|推荐|建议).*/.test(t) && t.length < 20) {
      return this.pick([
        '约会推荐来啦~ 🎯\n1. 一起去公园野餐 🧺\n2. 看一场浪漫电影 🎬\n3. 手牵手逛夜市 🏮\n4. 一起做手工/烘焙 🍰\n5. 去猫咖撸猫 🐱\n你觉得哪个最心动呀？',
        '让我想想... 🤔\n✨ 可以去游乐园坐摩天轮~\n✨ 或者找一家安静的咖啡厅聊聊天\n✨ 一起去看日落也很浪漫呢！\n选一个吧！💕',
        '约会灵感来咯 💡\n🌹 一起学做一道菜\n🎨 去画室画一幅画\n📸 找个好看的地方拍照\n最重要的是两个人在一起呀~'
      ])
    }

    // === 哄人话术 ===
    if (/(生气|哄|不开心|吵架|闹别扭|冷战|怎么办).*/.test(t) && t.length < 15) {
      return this.pick([
        '哄人秘籍来啦 📝\n1. 先认真道歉，态度最重要！🙇\n2. 买TA最爱吃的零食 🍫\n3. 写一封手写信 ✉️\n4. 给一个大大的拥抱 🤗\n记住：真诚比什么都管用哦~',
        'TA生气啦？别急~\n💬 先听TA说完，别急着反驳\n🌸 说一句"我理解你的感受"\n🎁 准备一个小惊喜\n💕 最重要的是让TA感受到你的在乎！',
        '吵架了没关系，这是感情的调味剂呢~\n✨ 先冷静10分钟\n✨ 然后主动发个可爱表情包\n✨ 说"我们和好吧"❤️\n相爱的人总会和好的！'
      ])
    }

    // === 情话 ===
    if (/(情话|土味情话|甜言蜜语|表白|说点什么|撩|撩人).*/.test(t)) {
      return this.pick([
        '来几句甜到齁的情话 🍯\n💬 "你是我所有小心思的源头"\n💬 "今天也超喜欢你，明天也是"\n💬 "遇见你之后，我的世界都亮了"\n💬 "你就是我的今日份甜度"\n快拿去用吧！😆💕',
        '土味情话来咯~ 😂\n🍬 "你猜我什么座？我是为你量身定做~"\n🍬 "你是不是偷了我的东西？偷了我的心！"\n🍬 "我最近胖了，因为想你想到膨胀~"\n哈哈哈快发给TA吧！',
        '甜言蜜语时间~ 🌸\n✨ "和你在一起的每一秒都很幸福"\n✨ "你笑起来比今天的阳光还温暖"\n✨ "余生很长，想和你慢慢走"\n收好啦！💝'
      ])
    }

    // === 夸人/TA ===
    if (/(夸|赞美|优点|漂亮|帅|可爱|喜欢TA).*/.test(t)) {
      return this.pick([
        '当然是使劲夸呀！😆\n🌟 "你今天真好看"（认真看着TA说）\n🌟 "有你真好"（突然说一句）\n🌟 "我是不是上辈子拯救了银河系才遇到你"\n真诚的夸奖最能打动人哦~ 💕',
        '夸TA嘛，最重要的是走心 ❤️\n不要说"你很漂亮"，要说"你今天穿这件衣服特别好看"\n不要说"你很好"，要说"你刚才那样做让我好感动"\n细节和真诚是夸人的秘诀哦~ ✨'
      ])
    }

    // === 早安 ===
    if (/(早安|早上好|起床|morning).*/.test(t)) {
      return this.pick([
        '早安呀~ ☀️ 新的一天要元气满满哦！记得给TA也发个早安 💕',
        '早上好！🌅 今天也是爱TA的一天呢！快去给TA说早安吧~',
        '叮咚~ 你的小精灵已经起床啦！🐣 今天有什么计划呀？'
      ])
    }

    // === 晚安 ===
    if (/(晚安|睡了|night|好困|困了).*/.test(t)) {
      return this.pick([
        '晚安呀~ 🌙 做个甜甜的梦，梦里要有TA哦！💤',
        '该睡觉啦！😴 睡前记得和TA说晚安哦，这是很重要的仪式感~ ✨',
        '晚安晚安！🌛 小精灵也要去充电啦，明天见！💕'
      ])
    }

    // === 心情不好 ===
    if (/(难过|伤心|不开心|想哭|委屈|郁闷|低落).*/.test(t)) {
      return this.pick([
        '抱抱你~ 🤗 不开心的时候想想TA对你的好呀\n或者吃点甜的，心情会变好的！🍰\n要记住，有人一直在乎着你呢 💕',
        '别难过呀 🥺 人生总有起起落落\n如果愿意的话，可以和我说说发生了什么~\n我虽然是小精灵，但也是很好的倾听者呢 👂✨',
        '来，给你一个虚拟的大拥抱 🤗💕\n不开心的事都会过去的\n别忘了还有TA在你身边呢~\n慢慢来，一切都会好起来的 🌈'
      ])
    }

    // === 想TA ===
    if (/(想TA|想念|思念|异地|异地恋|好久不见).*/.test(t)) {
      return this.pick([
        '异地恋的思念我懂... 🥺\n💌 给TA发一张你们的合照\n📞 打个电话听听TA的声音\n📝 写一封信寄给TA\n距离阻挡不了真心！加油 💪💕',
        '想念的话就去告诉TA呀~\n哪怕只是一句"我想你了"\nTA收到一定很开心的！❤️\n坚持异地恋的你们真的很棒 ✨',
        '小别胜新婚嘛~ 😊\n想想下次见面的场景\n一定会超级幸福的！\n现在的想念都是为了更好的重逢 💕'
      ])
    }

    // === 送礼 ===
    if (/(礼物|送礼|买什么|送什么|生日礼物|纪念日|惊喜).*/.test(t)) {
      return this.pick([
        '送礼指南来啦 🎁\n💝 手写情书 - 最用心！\n🧣 自己织的围巾 - 超温暖\n📸 情侣相册 - 满满的回忆\n🎨 定制情侣手链 - 独一无二\n最重要的不是价格，是心意哦~',
        '送礼物要投其所好呀！🎯\n想想TA最近有没有提过想要什么？\n或者观察TA的兴趣爱好~\n对的人，收到什么都开心的 💕',
        '惊喜不一定要很贵哦 ✨\n🌹 亲手做一顿饭\n🎵 录一首歌给TA\n📖 做一本你们的恋爱日记\n用心准备的礼物最动人！'
      ])
    }

    // === 纪念日 ===
    if (/(纪念日|多少天|在一起多久|天数|first meet).*/.test(t)) {
      const loveDate = wx.getStorageSync('loveDate')
      if (loveDate) {
        const start = new Date(loveDate)
        const now = new Date()
        const diff = Math.floor((now - start) / 1000 / 60 / 60 / 24)
        return `你们从 ${loveDate} 在一起，已经 ${diff} 天啦！🎉💕\n每一天都是珍贵的回忆呢~ 继续甜蜜下去吧 ✨`
      }
      return '你们还没有设置纪念日呢~ 😊\n去主页点击"我们的纪念日"设置一下吧！💕'
    }

    // === 谢谢 ===
    if (/(谢谢|感谢|thanks|thank|爱你|爱了).*/.test(t)) {
      return this.pick([
        '不客气呀~ 能帮到你我也很开心 😊💕',
        '嘿嘿，被夸了好开心！🥰 随时为你服务~',
        '爱你哟~ ❤️ 有什么需要随时找我！'
      ])
    }

    // === 再见 ===
    if (/(再见|拜拜|bye|下次|走了).*/.test(t)) {
      return this.pick([
        '拜拜~ 下次再来找我玩哦！👋💕',
        '好哒，我在这里等你回来~ 🌸 记得想我哦！',
        '再见啦！祝你今天开开心心的 ✨💕'
      ])
    }

    // === 功能询问 ===
    if (/(怎么用|功能|能做什么|help|帮助).*/.test(t)) {
      return '我可以帮你做这些事哦~ 🌟\n💕 聊天解闷，随时陪你\n📅 提醒纪念日和重要日子\n💡 提供约会创意\n💌 帮忙想情话哄人\n🎁 推荐礼物idea\n😊 倾听你的心事\n你想聊什么呀？'
    }

    // === 默认回复（多样化） ===
    return this.pick([
      '嗯嗯~ 我在认真听呢 💕 可以多说一点吗？',
      '嘿嘿，这个话题好有趣！继续说吧~ 😊',
      '有意思！🤔 不过小精灵还小，不太懂这个呢~ 换个话题好不好？',
      '哎呀，这个问题有点难倒我了 🥺 不过你可以试试问我关于约会、情话或者哄人的建议哦~',
      '哇~ 听起来很棒呢！✨ 还有呢还有呢？',
      '你说得对！💕 和TA在一起的时候也要这样想哦~',
      '嗯嗯（疯狂点头）😆 小精灵在听呢！',
      '嘿嘿，虽然我不太懂，但感觉你很开心呢~ 🥰',
      '这个嘛... 让我想想 🧐 不如问问你的TA怎么看？',
      '好啦好啦，小精灵收到了！📩 换个甜甜的话题好不好呀~ 🍬'
    ])
  },

  pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)]
  },

  updateLastAi(content) {
    const list = this.data.list.slice()
    const last = list[list.length - 1]
    if (last && last.type === 'ai') {
      last.content = content
      last.loading = false
    }
    this.setData({ list })
    // 保存 AI 回复
    this.saveChatHistory()
  },

  onHide() {
    // 页面隐藏时保存聊天记录
    this.saveChatHistory()
  },

  onUnload() {
    // 页面卸载时保存聊天记录
    this.saveChatHistory()
  },

  clearChat() {
    wx.showModal({
      title: '清除对话',
      content: '确定要清除所有聊天记录吗？',
      success: res => {
        if (res.confirm) {
          const defaultList = [{ type: 'ai', content: DEFAULT_GREETING }]
          this.setData({
            list: defaultList,
            loading: false
          })
          // 清除本地存储
          wx.removeStorageSync(CHAT_STORAGE_KEY)
        }
      }
    })
  }
})
