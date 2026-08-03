const db = wx.cloud.database()
const { getCoupleId } = require('../../utils/relationship')
const { callSharedData } = require('../../utils/sharedData')
const { waitForAuth } = require('../../utils/auth')

Page({
  data: {
    hasCouple: false,
    currentYear: new Date().getFullYear(),
    myCode: '',
    myName: '我',
    partnerName: 'Ta',
    goals: [],
    showForm: false,
    goalTitle: '',
    showTaskInput: {},     // { goalId: true }
    taskText: {}
  },

  async onLoad() {
    await waitForAuth()
    var mc = wx.getStorageSync('myCode') || ''
    var has = !!wx.getStorageSync('hasCouple')
    this.setData({
      myCode: mc,
      myName: wx.getStorageSync('myName') || '我',
      partnerName: wx.getStorageSync('partnerName') || 'Ta',
      hasCouple: has,
      currentYear: new Date().getFullYear()
    })
    if (has) this.loadGoals()
  },

  async onShow() {
    await waitForAuth()
    if (wx.getStorageSync('hasCouple')) {
      this.setData({ hasCouple: true })
      this.loadGoals()
    }
  },

  // ==================== 年份切换 ====================
  prevYear() {
    var y = this.data.currentYear - 1
    if (y < 2020) return
    this.setData({ currentYear: y }, function () { this.loadGoals() }.bind(this))
  },
  nextYear() {
    var y = this.data.currentYear + 1
    if (y > 2099) return
    this.setData({ currentYear: y }, function () { this.loadGoals() }.bind(this))
  },

  // ==================== 加载目标 ====================
  loadGoals() {
    var cp = getCoupleId()
    if (!cp) { this.setData({ goals: [] }); return }
    var year = this.data.currentYear
    var that = this
    db.collection('goals').where({ coupleId: cp, year: year }).orderBy('createTime', 'asc').limit(100).get()
      .then(function (res) {
        var goals = (res.data || []).map(function (g, i) {
          var goal = that.decorateGoal(g)
          goal.cardStyle = 'animation-delay: ' + (i * 60) + 'ms;'
          return goal
        })
        that.setData({ goals: goals })
      })
      .catch(function () { that.setData({ goals: [] }) })
  },

  decorateGoal(g) {
    var total = (g.tasks || []).length
    var done = (g.tasks || []).filter(function (t) { return t.done }).length
    var percent = total > 0 ? Math.round(done / total * 100) : 0
    var isMine = g.authorOpenid === (wx.getStorageSync('openid') || '')
    return Object.assign({}, g, {
      total: total,
      done: done,
      percent: percent,
      barStyle: 'width: ' + percent + '%;',
      isMine: isMine,
      ownerLabel: isMine ? this.data.myName : this.data.partnerName,
      allDone: total > 0 && done === total,
      tasks: (g.tasks || []).map(function (t) {
        return Object.assign({}, t, { doneAnim: false })
      })
    })
  },

  // ==================== 创建目标 ====================
  showAddForm() {
    if (!wx.getStorageSync('hasCouple')) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }
    this.setData({ showForm: true, goalTitle: '' })
  },
  hideAddForm() { this.setData({ showForm: false, goalTitle: '' }) },
  onGoalTitleInput(e) { this.setData({ goalTitle: e.detail.value }) },

  addGoal() {
    var title = (this.data.goalTitle || '').trim()
    if (!title) { wx.showToast({ title: '请输入目标名称', icon: 'none' }); return }
    var cp = getCoupleId()
    if (!cp) { wx.showToast({ title: '请先绑定情侣', icon: 'none' }); return }
    var mc = this.data.myCode || wx.getStorageSync('myCode') || ''
    if (!mc) { wx.showToast({ title: '用户信息异常', icon: 'none' }); return }
    var that = this
    wx.showLoading({ title: '创建中...' })
    db.collection('goals').add({ data: {
      coupleId: cp,
      authorOpenid: wx.getStorageSync('openid') || '',
      year: this.data.currentYear,
      title: title,
      tasks: [],
      authorCode: mc,
      authorName: wx.getStorageSync('myName') || '我',
      createTime: Date.now()
    }}).then(function () {
      wx.hideLoading()
      wx.showToast({ title: '目标已创建 ✨', icon: 'success' })
      that.setData({ showForm: false, goalTitle: '' })
      that.loadGoals()
    }).catch(function (err) {
      wx.hideLoading()
      console.error('创建目标失败:', err)
      var msg = '创建失败'
      if (err && err.errMsg) {
        if (err.errMsg.indexOf('permission') > -1) msg = '权限不足，请检查数据库权限'
        else if (err.errMsg.indexOf('timeout') > -1) msg = '网络超时，请重试'
        else msg = err.errMsg
      }
      wx.showToast({ title: msg, icon: 'none', duration: 3000 })
    })
  },

  // ==================== 删除目标 ====================
  deleteGoal(e) {
    var id = e.currentTarget.dataset.id
    var goal = this.data.goals.find(function (g) { return g._id === id })
    if (!goal || !goal.isMine) { wx.showToast({ title: '只能删除自己创建的目标', icon: 'none' }); return }
    var that = this
    wx.showModal({
      title: '删除目标', content: '确定删除「' + goal.title + '」吗？所有子任务也会被删除。',
      confirmColor: '#ff6b8a',
      success: function (r) {
        if (!r.confirm) return
        callSharedData('deleteOwnedRecord', { collection: 'goals', id: id }).then(function () {
          wx.showToast({ title: '已删除' })
          that.loadGoals()
        }).catch(function (err) {
          wx.showToast({ title: err.message || '删除失败', icon: 'none' })
        })
      }
    })
  },

  // ==================== 子任务展开/收起 ====================
  toggleTaskInput(e) {
    var id = e.currentTarget.dataset.id
    var showTaskInput = this.data.showTaskInput
    showTaskInput[id] = !showTaskInput[id]
    this.setData({ showTaskInput: showTaskInput })
  },

  onTaskTextInput(e) {
    var id = e.currentTarget.dataset.id
    var taskText = this.data.taskText
    taskText[id] = e.detail.value
    this.setData({ taskText: taskText })
  },

  // ==================== 添加子任务 ====================
  addSubTask(e) {
    var id = e.currentTarget.dataset.id
    var text = (this.data.taskText[id] || '').trim()
    if (!text) { wx.showToast({ title: '请输入任务内容', icon: 'none' }); return }
    var that = this
    wx.showLoading({ title: '添加中...' })
    callSharedData('mutateGoalTask', { id: id, operation: 'add', text: text }).then(function () {
      wx.hideLoading()
      var taskText = that.data.taskText
      taskText[id] = ''
      var showTaskInput = that.data.showTaskInput
      showTaskInput[id] = false
      that.setData({ taskText: taskText, showTaskInput: showTaskInput })
      that.loadGoals()
    }).catch(function () {
      wx.hideLoading()
      wx.showToast({ title: '添加失败', icon: 'none' })
    })
  },

  // ==================== 切换子任务完成状态 ====================
  toggleTask(e) {
    var goalId = e.currentTarget.dataset.goalId
    var taskId = e.currentTarget.dataset.taskId
    var goal = this.data.goals.find(function (g) { return g._id === goalId })
    if (!goal) return
    var tasks = goal.tasks.map(function (t) {
      if (t.id === taskId) {
        return Object.assign({}, t, { done: !t.done })
      }
      return t
    })
    var updatedGoal = Object.assign({}, goal, { tasks: tasks })
    updatedGoal = this.decorateGoal(updatedGoal)

    // 先更新本地显示（动画）
    this.setData({ goals: this.data.goals.map(function (g) {
      return g._id === goalId ? updatedGoal : g
    })})

    // 异步写入云端
    var nowDone = tasks.find(function (t) { return t.id === taskId }).done
    var that = this
    callSharedData('mutateGoalTask', { id: goalId, operation: 'toggle', taskId: taskId }).then(function () {
      if (updatedGoal.allDone && nowDone) {
        wx.showToast({ title: '🎉 目标全部完成！', icon: 'success' })
      }
      that.loadGoals()
    }).catch(function () {
      wx.showToast({ title: '更新失败', icon: 'none' })
      that.loadGoals()
    })
  },

  // ==================== 删除子任务 ====================
  deleteTask(e) {
    var goalId = e.currentTarget.dataset.goalId
    var taskId = e.currentTarget.dataset.taskId
    var goal = this.data.goals.find(function (g) { return g._id === goalId })
    if (!goal) return
    var that = this
    callSharedData('mutateGoalTask', { id: goalId, operation: 'delete', taskId: taskId }).then(function () {
      that.loadGoals()
    }).catch(function (err) {
      wx.showToast({ title: err.message || '删除失败', icon: 'none' })
    })
  }
})
