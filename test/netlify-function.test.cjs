const assert = require('node:assert/strict');
const http = require('node:http');
const { test } = require('node:test');

test('Netlify API login stores the initial officer and session in Supabase state', async () => {
  let savedState = null;
  let lockAcquired = false;
  let lockReleased = false;

  const mockSupabase = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      response.setHeader('Content-Type', 'application/json');
      if (request.url.includes('police_app_state_acquire_lock')) {
        lockAcquired = true;
        response.end('true');
      } else if (request.url.includes('police_app_state_release_lock')) {
        lockReleased = true;
        response.end('true');
      } else if (request.method === 'GET' && request.url.startsWith('/rest/v1/police_app_state')) {
        response.end(JSON.stringify({ state: {} }));
      } else if (request.method === 'PATCH' && request.url.startsWith('/rest/v1/police_app_state')) {
        savedState = JSON.parse(body).state;
        response.end(JSON.stringify({ id: 'main' }));
      } else {
        response.statusCode = 404;
        response.end(JSON.stringify({ message: `Unexpected mock request: ${request.method} ${request.url}` }));
      }
    });
  });

  await new Promise((resolve) => mockSupabase.listen(0, '127.0.0.1', resolve));
  process.env.NETLIFY = 'true';
  process.env.TEMP = 'D:\\';
  process.env.TMP = 'D:\\';
  process.env.SUPABASE_URL = `http://127.0.0.1:${mockSupabase.address().port}`;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

  try {
    const { handler } = require('../netlify/functions/api');
    const response = await handler({
      httpMethod: 'POST',
      path: '/.netlify/functions/api/auth/login',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ badge: 'MELU101', password: 'Melu123!' }),
      isBase64Encoded: false,
    }, {});

    const result = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.ok(result.token);
    assert.equal(result.officer.badge, 'MELU101');
    assert.equal(savedState.officers[0].badge, 'MELU101');
    assert.equal(Object.keys(savedState.sessions).length, 1);
    assert.equal(lockAcquired, true);
    assert.equal(lockReleased, true);
  } finally {
    await new Promise((resolve, reject) => mockSupabase.close((error) => error ? reject(error) : resolve()));
  }
});
