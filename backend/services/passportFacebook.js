const passport = require('passport');
const FacebookStrategy = require('passport-facebook').Strategy;

function initFacebookPassport(verifyFn) {
  if (!process.env.FACEBOOK_CLIENT_ID || !process.env.FACEBOOK_CLIENT_SECRET) {
    return; // Not configured; keep routes inactive
  }
  const callbackURL = `${process.env.BACKEND_BASE || 'http://localhost:3000'}/api/auth/facebook/callback`;
  const strategy = new FacebookStrategy({
    clientID: process.env.FACEBOOK_CLIENT_ID,
    clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
    callbackURL,
    profileFields: ['id', 'displayName', 'emails'],
    enableProof: true
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email = (profile.emails && profile.emails[0] && profile.emails[0].value) || null;
      const payload = {
        provider: 'facebook',
        providerUserId: profile.id,
        email,
        emailVerified: !!email,
        name: profile.displayName || ''
      };
      const user = await verifyFn(payload);
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  });
  passport.use(strategy);
}

module.exports = { initFacebookPassport };
