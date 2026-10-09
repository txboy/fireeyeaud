'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = { width: 1280, height: 800 };

function statePath(userData) {
  return path.join(userData, 'window-state.json');
}

function loadWindowState(userData) {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(userData), 'utf8'));
    const state = { ...DEFAULTS };
    for (const key of ['x', 'y', 'width', 'height']) {
      if (typeof raw[key] === 'number') state[key] = raw[key];
    }
    return state;
  } catch {
    return { ...DEFAULTS };
  }
}

function saveWindowState(userData, bounds) {
  try {
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(statePath(userData), JSON.stringify(bounds, null, 2));
  } catch {
    /* best-effort persistence */
  }
}

module.exports = { loadWindowState, saveWindowState, statePath, DEFAULTS };
