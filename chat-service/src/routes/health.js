function healthRouter(req, res) {
  res.json({ ok: true, service: 'chat-service' });
}

module.exports = { healthRouter };
