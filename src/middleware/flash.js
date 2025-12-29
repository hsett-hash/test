function setFlash(req, type, message) {
  req.session.flash = { type, message };
}

function exposeFlash(req, res, next) {
  res.locals.flash = req.session.flash ?? null;
  if (req.session.flash) delete req.session.flash;
  next();
}

module.exports = { setFlash, exposeFlash };

