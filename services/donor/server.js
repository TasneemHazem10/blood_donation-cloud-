'use strict';

const { createStore } = require('../../shared/store');
const { setStore } = require('../../shared/context');
const { createApp } = require('./app');

const port = Number(process.env.PORT || 3002);
setStore(createStore());
createApp().listen(port, () => console.log(`Donor service ready on http://localhost:${port}`));
