const serverless = require('serverless-http');
const app = require('../../server');

const expressHandler = serverless(app);
const functionPrefix = '/.netlify/functions/api';

exports.handler = (event, context) => {
  const requestPath = event.path || new URL(event.rawUrl).pathname;
  if (requestPath.startsWith(functionPrefix)) {
    event.path = `/api${requestPath.slice(functionPrefix.length)}`;
  }
  return expressHandler(event, context);
};
