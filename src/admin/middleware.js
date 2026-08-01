/**
 * Auth Middleware — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.path === '/login' || req.path === '/logout') {
    return next();
  }
  res.redirect('/admin/login');
}

module.exports = { requireAuth };
