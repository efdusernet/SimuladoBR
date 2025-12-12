(function (global) {
  function ExamEngine(config) {
    this.sessionId = null;
    this.mode = null;
    this.exam = null;
    this.questions = [];
    this.order = [];
    this.answers = new Map();
    this.startedAt = null;
    this.storageKey = null;
    this.config = config || {};
  }

  ExamEngine.prototype.init = function (blueprint, mode, sessionId) {
    this.sessionId = sessionId || null;
    this.mode = mode || null;
    this.exam = blueprint || null;
    this.startedAt = Date.now();
    this.storageKey = this.sessionId ? ('exam-engine:session:' + this.sessionId) : null;
    return this;
  };

  ExamEngine.prototype.setQuestions = function (questions) {
    this.questions = Array.isArray(questions) ? questions.slice() : [];
    this.order = this.questions.map(function (q) { return Number(q && q.id); }).filter(function (n) { return Number.isFinite(n); });
    return this;
  };

  ExamEngine.prototype.shuffleOnce = function () {
    var arr = this.order;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  };

  ExamEngine.prototype.getQuestionByIndex = function (index) {
    var qid = this.order[index];
    if (!Number.isFinite(qid)) return null;
    for (var i = 0; i < this.questions.length; i++) {
      if (Number(this.questions[i].id) === Number(qid)) return this.questions[i];
    }
    return null;
  };

  ExamEngine.prototype.answerSingle = function (questionId, optionId) {
    var qid = Number(questionId);
    if (!Number.isFinite(qid)) return false;
    var oid = (optionId == null) ? null : Number(optionId);
    this.answers.set(qid, { multi: false, optionId: Number.isFinite(oid) ? oid : null });
    return true;
  };

  ExamEngine.prototype.answerMulti = function (questionId, optionIds) {
    var qid = Number(questionId);
    if (!Number.isFinite(qid)) return false;
    var ids = Array.isArray(optionIds) ? optionIds.map(function (x) { return Number(x); }).filter(function (n) { return Number.isFinite(n); }) : [];
    this.answers.set(qid, { multi: true, optionIds: ids });
    return true;
  };

  ExamEngine.prototype.save = function () {
    if (!this.storageKey) return false;
    try {
      var payload = {
        sessionId: this.sessionId,
        mode: this.mode,
        startedAt: this.startedAt,
        order: this.order,
        answers: Array.from(this.answers.entries()),
      };
      global.sessionStorage && global.sessionStorage.setItem(this.storageKey, JSON.stringify(payload));
      return true;
    } catch (e) { return false; }
  };

  ExamEngine.prototype.restore = function (sessionId) {
    var key = sessionId ? ('exam-engine:session:' + sessionId) : this.storageKey;
    if (!key) return false;
    try {
      var raw = global.sessionStorage && global.sessionStorage.getItem(key);
      if (!raw) return false;
      var data = JSON.parse(raw);
      this.sessionId = data.sessionId || this.sessionId;
      this.mode = data.mode || this.mode;
      this.startedAt = data.startedAt || this.startedAt;
      this.order = Array.isArray(data.order) ? data.order.slice() : this.order;
      this.answers = new Map(Array.isArray(data.answers) ? data.answers : []);
      this.storageKey = key;
      return true;
    } catch (e) { return false; }
  };

  ExamEngine.prototype.getProgress = function () {
    var total = this.order.length;
    var answered = 0;
    var it = this.answers.keys();
    while (true) {
      var n = it.next();
      if (n.done) break;
      answered += 1;
    }
    return { total: total, answered: answered };
  };

  ExamEngine.prototype.getResultsSnapshot = function () {
    return {
      sessionId: this.sessionId,
      mode: this.mode,
      exam: this.exam,
      progress: this.getProgress(),
      answers: Array.from(this.answers.entries())
    };
  };

  ExamEngine.prototype.submit = function (payload) {
    var mode = this.mode || 'quiz';
    var isFull = (mode === 'full' || this.questions.length === 180);
    if (isFull && this.questions.length >= 180) {
      return { action: 'redirect', target: 'examPmiResults', payload: payload };
    }
    return { action: 'clear-and-home', payload: payload };
  };

  ExamEngine.prototype.getCheckpoint = function (currentIndex) {
    var mode = this.mode || 'quiz';
    if (mode !== 'full') return null;
    var checks = (this.exam && this.exam.pausas && Array.isArray(this.exam.pausas.checkpoints)) ? this.exam.pausas.checkpoints : [60, 120];
    for (var i = 0; i < checks.length; i++) {
      var cp = checks[i] - 1;
      if (currentIndex === cp) return { index: cp, checkpoint: i + 1, pauseMinutes: 10 };
    }
    return null;
  };

  global.ExamEngine = ExamEngine;
})(window);
