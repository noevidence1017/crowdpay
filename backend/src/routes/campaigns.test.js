const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const proxyquire = require('proxyquire').noCallThru();

function buildApp({
  queryImpl,
  buildWithdrawalTransactionImpl,
  insertWithdrawalPendingSignaturesImpl,
  authUser,
  campaignStatusImpl,
}) {
  const router = proxyquire('./campaigns', {
    '../services/campaignStatusService': campaignStatusImpl || {
      refreshCampaignStatus: async () => ({ failed: null, funded: null }),
      refreshActiveCampaignStatuses: async () => ({ failed: [], funded: [] }),
    },
    '../config/database': {
      query: queryImpl,
      connect: async () => ({ query: queryImpl, release: async () => {} }),
    },
    '../services/stellarService': {
      createCampaignWallet: async () => ({ publicKey: 'GPK', secret: 'S' }),
      getCampaignBalance: async () => ({}),
      getSupportedAssetCodes: () => ['XLM', 'USDC'],
      buildWithdrawalTransaction: buildWithdrawalTransactionImpl,
    },
    '../services/ledgerMonitor': {
      watchCampaignWallet: async () => {},
    },
    '../services/stellarTransactionService': {
      insertWithdrawalPendingSignatures: insertWithdrawalPendingSignaturesImpl,
    },
    '../middleware/auth': {
      requireAuth: (req, _res, next) => {
        req.user = authUser || { userId: 'platform-1', role: 'admin' };
        next();
      },
      requireRole: () => (req, _res, next) => {
        next();
      },
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/campaigns', router);
  return app;
}

test('POST /api/campaigns/cron/fail-expired returns failed and funded campaigns', async () => {
  const app = buildApp({
    queryImpl: async () => ({ rows: [] }),
    buildWithdrawalTransactionImpl: async () => '',
    insertWithdrawalPendingSignaturesImpl: async () => 'tx-row',
    campaignStatusImpl: {
      refreshActiveCampaignStatuses: async () => ({
        failed: [{
          id: 'c-1',
          title: 'Campaign 1',
          target_amount: '100',
          raised_amount: '50',
          deadline: '2026-04-23',
          status: 'failed',
        }],
        funded: [{ id: 'c-2', title: 'Funded', status: 'funded' }],
      }),
    },
  });

  const response = await request(app)
    .post('/api/campaigns/cron/fail-expired')
    .set('Authorization', 'Bearer token');

  assert.equal(response.status, 200);
  assert.equal(response.body.failedCampaigns.length, 1);
  assert.equal(response.body.fundedCampaigns.length, 1);
});

test('POST /api/campaigns blocks unverified creators when KYC gate is enabled', async (t) => {
  const previous = process.env.KYC_REQUIRED_FOR_CAMPAIGNS;
  t.after(() => {
    if (previous === undefined) delete process.env.KYC_REQUIRED_FOR_CAMPAIGNS;
    else process.env.KYC_REQUIRED_FOR_CAMPAIGNS = previous;
  });
  process.env.KYC_REQUIRED_FOR_CAMPAIGNS = 'true';

  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async (text) => {
      if (text.includes('SELECT email, wallet_public_key, kyc_status FROM users')) {
        return { rows: [{ wallet_public_key: 'GCREATOR', kyc_status: 'pending' }] };
      }
      return { rows: [] };
    },
    buildWithdrawalTransactionImpl: async () => '',
    insertWithdrawalPendingSignaturesImpl: async () => 'tx-row',
  });

  const response = await request(app)
    .post('/api/campaigns')
    .set('Authorization', 'Bearer token')
    .send({ title: 'Verified only', target_amount: '100', asset_type: 'USDC' });

  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'KYC_REQUIRED');
});

test('POST /api/campaigns allows creation when KYC gate is disabled', async (t) => {
  const previous = process.env.KYC_REQUIRED_FOR_CAMPAIGNS;
  t.after(() => {
    if (previous === undefined) delete process.env.KYC_REQUIRED_FOR_CAMPAIGNS;
    else process.env.KYC_REQUIRED_FOR_CAMPAIGNS = previous;
  });
  process.env.KYC_REQUIRED_FOR_CAMPAIGNS = 'false';

  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async (text) => {
      if (text.includes('SELECT email, wallet_public_key, kyc_status FROM users')) {
        return { rows: [{ wallet_public_key: 'GCREATOR', kyc_status: 'unverified' }] };
      }
      if (text.includes('INSERT INTO campaigns')) {
        return {
          rows: [
            {
              id: 'campaign-1',
              title: 'Dev campaign',
              asset_type: 'USDC',
              creator_id: 'creator-1',
            },
          ],
        };
      }
      return { rows: [] };
    },
    buildWithdrawalTransactionImpl: async () => '',
    insertWithdrawalPendingSignaturesImpl: async () => 'tx-row',
  });

  const response = await request(app)
    .post('/api/campaigns')
    .set('Authorization', 'Bearer token')
    .send({ title: 'Dev campaign', target_amount: '100', asset_type: 'USDC' });

  assert.equal(response.status, 201);
  assert.equal(response.body.id, 'campaign-1');
});

test('POST /api/campaigns returns 500 and logs orphaned wallet when DB insert fails', async () => {
  process.env.KYC_REQUIRED_FOR_CAMPAIGNS = 'false';
  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async (text) => {
      if (text.includes('SELECT email, wallet_public_key, kyc_status FROM users')) {
        return { rows: [{ email: 'creator@test.com', wallet_public_key: 'GCREATOR', kyc_status: 'verified' }] };
      }
      if (text === 'BEGIN' || text === 'ROLLBACK') return { rows: [] };
      if (text.includes('INSERT INTO campaigns')) {
        throw new Error('unique constraint violation');
      }
      return { rows: [] };
    },
    buildWithdrawalTransactionImpl: async () => '',
    insertWithdrawalPendingSignaturesImpl: async () => 'tx-row',
  });

  const response = await request(app)
    .post('/api/campaigns')
    .set('Authorization', 'Bearer token')
    .send({ title: 'Broken campaign', target_amount: '100', asset_type: 'USDC' });

  assert.equal(response.status, 500);
  assert.match(response.body.error, /contact support/i);
});

test('POST /api/campaigns returns 400 with validation errors for invalid payload', async () => {
  process.env.KYC_REQUIRED_FOR_CAMPAIGNS = 'false';
  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async () => ({ rows: [] }),
    buildWithdrawalTransactionImpl: async () => '',
    insertWithdrawalPendingSignaturesImpl: async () => 'tx-row',
  });

  const response = await request(app)
    .post('/api/campaigns')
    .set('Authorization', 'Bearer token')
    .send({ title: '', target_amount: -5, asset_type: 'INVALID' });

  assert.equal(response.status, 400);
  assert.ok(Array.isArray(response.body.errors));
  assert.ok(response.body.errors.length >= 1);
});

test('POST /api/campaigns returns 400 for past deadline', async () => {
  process.env.KYC_REQUIRED_FOR_CAMPAIGNS = 'false';
  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async (text) => {
      if (text.includes('SELECT email, wallet_public_key, kyc_status FROM users')) {
        return { rows: [{ email: 'creator@test.com', wallet_public_key: 'GCREATOR', kyc_status: 'verified' }] };
      }
      return { rows: [] };
    },
    buildWithdrawalTransactionImpl: async () => '',
    insertWithdrawalPendingSignaturesImpl: async () => 'tx-row',
  });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const pastDeadline = yesterday.toISOString().split('T')[0];

  const response = await request(app)
    .post('/api/campaigns')
    .set('Authorization', 'Bearer token')
    .send({ title: 'Old deadline', target_amount: '100', asset_type: 'USDC', deadline: pastDeadline });

  assert.equal(response.status, 400);
  assert.ok(Array.isArray(response.body.errors) || response.body.error);
  assert.ok(
    (response.body.errors || []).some((error) => String(error.msg || error).toLowerCase().includes('deadline must be in the future')) ||
    String(response.body.error).toLowerCase().includes('deadline must be a future date')
  );
});

test('POST /api/campaigns/:id/trigger-refunds creates refund requests for contributions', async () => {
  const created = [];
  const queryImpl = async (text, params) => {
    if (text.includes('SELECT id, wallet_public_key, status FROM campaigns')) {
      return { rows: [{ id: 'c-1', wallet_public_key: 'GPK', status: 'failed' }] };
    }
    if (text.includes('FROM contributions c')) {
      return {
        rows: [
          {
            id: 'contrib-1',
            campaign_id: 'c-1',
            sender_public_key: 'GSENDER',
            amount: '15.0000000',
            asset: 'USDC',
            payment_type: 'payment',
            source_amount: null,
            source_asset: null,
            conversion_rate: null,
            path: null,
            tx_hash: 'tx-1',
            created_at: '2026-04-23T12:00:00Z',
          },
        ],
      };
    }
    if (text.includes('INSERT INTO withdrawal_requests')) {
      return { rows: [{ id: 'wr-1' }] };
    }
    return { rows: [] };
  };

  const app = buildApp({
    queryImpl,
    buildWithdrawalTransactionImpl: async () => 'unsigned-xdr',
    insertWithdrawalPendingSignaturesImpl: async (client, { withdrawalRequestId }) => {
      created.push(withdrawalRequestId);
      return 'stellar-row-id';
    },
  });

  const response = await request(app)
    .post('/api/campaigns/c-1/trigger-refunds')
    .set('Authorization', 'Bearer token');

  assert.equal(response.status, 201);
  assert.equal(response.body.refundsCreated, 1);
  assert.equal(created.length, 1);
  assert.equal(created[0], 'wr-1');
});

test('GET /api/campaigns supports search, asset filter, and sort', async () => {
  const queries = [];
  const app = buildApp({
    queryImpl: async (text, params) => {
      queries.push({ text, params });
      if (text.includes('COUNT(*)')) {
        return { rows: [{ total: 1 }] };
      }
      return {
        rows: [
          {
            id: 'camp-1',
            title: 'Solar panels',
            description: 'Clean energy',
            asset_type: 'USDC',
            status: 'active',
            raised_amount: '80',
            target_amount: '100',
          },
        ],
      };
    },
  });

  const response = await request(app).get(
    '/api/campaigns?search=solar&asset=USDC&sort=closest_to_goal'
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.campaigns.length, 1);
  const listQuery = queries.find((q) => q.text.includes('ORDER BY'));
  assert.ok(listQuery);
  assert.match(listQuery.text, /ILIKE/i);
  assert.match(listQuery.text, /raised_amount \/ NULLIF/i);
  assert.ok(listQuery.params.includes('%solar%'));
  assert.ok(listQuery.params.includes('USDC'));
});

// Campaign Webhooks Tests

test('POST /api/campaigns/:id/webhooks registers a campaign webhook', async () => {
  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async (text) => {
      if (text.includes('SELECT id FROM campaigns WHERE id = $1')) {
        return { rows: [{ id: 'campaign-1' }] };
      }
      if (text.includes('SELECT creator_id FROM campaigns')) {
        return { rows: [{ creator_id: 'creator-1' }] };
      }
      if (text.includes('COUNT(*)')) {
        return { rows: [{ count: 2 }] };
      }
      if (text.includes('INSERT INTO campaign_webhooks')) {
        return {
          rows: [{
            id: 'wh-1',
            campaign_id: 'campaign-1',
            url: 'https://example.com/webhook',
            events: ['contribution.indexed'],
            created_at: '2026-06-02T00:00:00Z'
          }]
        };
      }
      return { rows: [] };
    },
  });

  const response = await request(app)
    .post('/api/campaigns/campaign-1/webhooks')
    .set('Authorization', 'Bearer token')
    .send({
      url: 'https://example.com/webhook',
      events: ['contribution.indexed']
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.id, 'wh-1');
  assert.equal(response.body.url, 'https://example.com/webhook');
  assert.ok(response.body.secret);
  assert.ok(response.body.message.includes('Store the signing secret'));
});

test('POST /api/campaigns/:id/webhooks rejects invalid URLs', async () => {
  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async (text) => {
      if (text.includes('SELECT id FROM campaigns WHERE id = $1')) {
        return { rows: [{ id: 'campaign-1' }] };
      }
      if (text.includes('SELECT creator_id FROM campaigns')) {
        return { rows: [{ creator_id: 'creator-1' }] };
      }
      return { rows: [] };
    },
  });

  const response = await request(app)
    .post('/api/campaigns/campaign-1/webhooks')
    .set('Authorization', 'Bearer token')
    .send({ url: 'http://example.com' }); // HTTP, not HTTPS

  assert.equal(response.status, 400);
  assert.match(response.body.error, /https/i);
});

test('POST /api/campaigns/:id/webhooks enforces 5 webhook limit', async () => {
  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async (text) => {
      if (text.includes('SELECT id FROM campaigns WHERE id = $1')) {
        return { rows: [{ id: 'campaign-1' }] };
      }
      if (text.includes('SELECT creator_id FROM campaigns')) {
        return { rows: [{ creator_id: 'creator-1' }] };
      }
      if (text.includes('COUNT(*)')) {
        return { rows: [{ count: 5 }] }; // Already at limit
      }
      return { rows: [] };
    },
  });

  const response = await request(app)
    .post('/api/campaigns/campaign-1/webhooks')
    .set('Authorization', 'Bearer token')
    .send({ url: 'https://example.com/webhook' });

  assert.equal(response.status, 429);
  assert.match(response.body.error, /limit/i);
});

test('GET /api/campaigns/:id/webhooks lists webhooks for campaign', async () => {
  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async (text) => {
      if (text.includes('SELECT id FROM campaigns WHERE id = $1')) {
        return { rows: [{ id: 'campaign-1' }] };
      }
      if (text.includes('SELECT creator_id FROM campaigns')) {
        return { rows: [{ creator_id: 'creator-1' }] };
      }
      if (text.includes('SELECT id, url, events, active')) {
        return {
          rows: [{
            id: 'wh-1',
            url: 'https://example.com/webhook',
            events: ['contribution.indexed'],
            active: true,
            created_at: '2026-06-02T00:00:00Z',
            secret_hint: '1234567890…cdef'
          }]
        };
      }
      return { rows: [] };
    },
  });

  const response = await request(app)
    .get('/api/campaigns/campaign-1/webhooks')
    .set('Authorization', 'Bearer token');

  assert.equal(response.status, 200);
  assert.equal(response.body.length, 1);
  assert.equal(response.body[0].id, 'wh-1');
  assert.ok(response.body[0].secret_hint.includes('…'));
});

test('DELETE /api/campaigns/:id/webhooks/:wid disables a webhook', async () => {
  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async (text) => {
      if (text.includes('SELECT id FROM campaigns WHERE id = $1')) {
        return { rows: [{ id: 'campaign-1' }] };
      }
      if (text.includes('SELECT creator_id FROM campaigns')) {
        return { rows: [{ creator_id: 'creator-1' }] };
      }
      if (text.includes('UPDATE campaign_webhooks')) {
        return { rows: [{ id: 'wh-1' }] };
      }
      return { rows: [] };
    },
  });

  const response = await request(app)
    .delete('/api/campaigns/campaign-1/webhooks/wh-1')
    .set('Authorization', 'Bearer token');

  assert.equal(response.status, 200);
  assert.equal(response.body.revoked, true);
  assert.equal(response.body.id, 'wh-1');
});

test('GET /api/campaigns/:id/webhooks/:wid/deliveries shows delivery history', async () => {
  const app = buildApp({
    authUser: { userId: 'creator-1', role: 'creator' },
    queryImpl: async (text, params) => {
      if (text.includes('SELECT id FROM campaigns WHERE id = $1')) {
        return { rows: [{ id: 'campaign-1' }] };
      }
      if (text.includes('SELECT creator_id FROM campaigns')) {
        return { rows: [{ creator_id: 'creator-1' }] };
      }
      if (text.includes('SELECT id FROM campaign_webhooks')) {
        return { rows: [{ id: 'wh-1' }] };
      }
      if (text.includes('COUNT(*)')) {
        return { rows: [{ total: 1 }] };
      }
      if (text.includes('SELECT id, event, status')) {
        return {
          rows: [{
            id: 'del-1',
            event: 'contribution.indexed',
            status: 'delivered',
            response_status: 200,
            attempt_count: 1,
            last_error: null,
            delivered_at: '2026-06-02T10:30:00Z',
            failed_at: null,
            created_at: '2026-06-02T10:29:00Z',
            updated_at: '2026-06-02T10:30:00Z'
          }]
        };
      }
      return { rows: [] };
    },
  });

  const response = await request(app)
    .get('/api/campaigns/campaign-1/webhooks/wh-1/deliveries')
    .set('Authorization', 'Bearer token');

  assert.equal(response.status, 200);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.deliveries.length, 1);
  assert.equal(response.body.deliveries[0].status, 'delivered');
  assert.equal(response.body.deliveries[0].response_status, 200);
});
