/**
 * Admin Server — infinityX Bot
 * Developer: Tarif Ahmed (infinityX)
 * Telegram: https://t.me/infinityxbd
 */
const express = require('express');
const session = require('express-session');
const path = require('path');

function createAdminServer(botState, client) {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // No-cache for admin panel (fresh HTML every load)
  app.use('/admin', (req, res, next) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    next();
  });
  app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      maxAge: 24 * 60 * 60 * 1000
    }
  }));

  const routes = require('./routes')(botState, client);
  app.use('/admin', routes);

  app.get('/', (req, res) => res.redirect('/admin'));

  return app;
}

module.exports = createAdminServer;
