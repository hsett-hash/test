function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  req.session.returnTo = req.originalUrl;
  res.redirect("/login");
}

function exposeAuth(req, res, next) {
  res.locals.currentUser = req.session?.user ?? null;
  next();
}

module.exports = { requireAuth, exposeAuth };

