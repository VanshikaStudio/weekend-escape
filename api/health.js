const { sendJson } = require('../lib/http');

module.exports = function health(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }
  return sendJson(res, 200, { status: 'ok', service: 'weekend-escape' });
};
