const test = require('node:test');
const assert = require('node:assert/strict');
const proxyquire = require('proxyquire').noCallThru();

test('refreshActiveCampaignStatuses marks funded and failed campaigns', async () => {
  const queries = [];
  const { refreshActiveCampaignStatuses } = proxyquire('./campaignStatusService', {
    '../config/database': {
      query: async (text) => {
        queries.push(text);
        if (text.includes("SET status = 'funded'")) {
          return { rows: [{ id: 'funded-1', status: 'funded' }] };
        }
        if (text.includes("SET status = 'failed'")) {
          return { rows: [{ id: 'failed-1', status: 'failed' }] };
        }
        return { rows: [] };
      },
    },
    '../config/logger': { info: () => {}, error: () => {} },
  });

  const result = await refreshActiveCampaignStatuses();
  assert.equal(result.funded.length, 1);
  assert.equal(result.failed.length, 1);
  assert.ok(queries.some((q) => q.includes("SET status = 'funded'")));
  assert.ok(queries.some((q) => q.includes("SET status = 'failed'")));
});

test('refreshCampaignStatus updates a single campaign', async () => {
  const { refreshCampaignStatus } = proxyquire('./campaignStatusService', {
    '../config/database': {
      query: async (text, params) => {
        assert.equal(params[0], 'camp-uuid');
        if (text.includes("SET status = 'failed'")) return { rows: [] };
        if (text.includes("SET status = 'funded'")) {
          return { rows: [{ id: 'camp-uuid', status: 'funded' }] };
        }
        return { rows: [] };
      },
    },
    '../config/logger': { info: () => {}, error: () => {} },
  });

  const result = await refreshCampaignStatus('camp-uuid');
  assert.equal(result.funded?.status, 'funded');
  assert.equal(result.failed, null);
});

test('processRefundsForCampaign processes refunds, retries on failure, updates DB, and sends emails', async () => {
  const refundCalls = [];
  const emailCalls = [];
  const dbQueries = [];

  const mockSorobanService = {
    refund: async (contractId, contributorPublicKey) => {
      refundCalls.push({ contractId, contributorPublicKey });
      if (contributorPublicKey === 'fail-key') {
        throw new Error('Soroban error');
      }
    }
  };

  const mockEmailService = {
    sendEmail: async (options) => {
      emailCalls.push(options);
    }
  };

  const mockDb = {
    query: async (text, params) => {
      dbQueries.push({ text, params });
      if (text.includes('contributions') && text.includes('refunded = FALSE')) {
        return {
          rows: [
            { id: 'contrib-1', sender_public_key: 'user-key-1', amount: '10.0', asset: 'USDC' },
            { id: 'contrib-2', sender_public_key: 'fail-key', amount: '5.0', asset: 'XLM' }
          ]
        };
      }
      if (text.includes('SELECT email, name FROM users WHERE wallet_public_key = $1')) {
        return {
          rows: [{ email: `email-${params[0]}@test.com`, name: `User ${params[0]}` }]
        };
      }
      return { rows: [] };
    }
  };

  const { processRefundsForCampaign } = proxyquire('./campaignStatusService', {
    '../config/database': mockDb,
    '../config/logger': {
      info: () => {},
      warn: () => {},
      error: () => {}
    },
    './sorobanService': mockSorobanService,
    './emailService': mockEmailService
  });

  const mockCampaign = {
    id: 'campaign-1',
    title: 'Test Campaign',
    escrow_contract_id: 'escrow-123'
  };

  await processRefundsForCampaign(mockCampaign);

  // Assertions:
  // 1. Should call refund for both. fail-key fails, so it's retried 3 times.
  assert.equal(refundCalls.length, 4);
  assert.deepEqual(refundCalls[0], { contractId: 'escrow-123', contributorPublicKey: 'user-key-1' });
  assert.deepEqual(refundCalls[1], { contractId: 'escrow-123', contributorPublicKey: 'fail-key' });
  assert.deepEqual(refundCalls[2], { contractId: 'escrow-123', contributorPublicKey: 'fail-key' });
  assert.deepEqual(refundCalls[3], { contractId: 'escrow-123', contributorPublicKey: 'fail-key' });

  // 2. Should update refunded = TRUE only for successful one
  const updateQuery = dbQueries.find(q => q.text.includes('UPDATE contributions') && q.params[0] === 'contrib-1');
  assert.ok(updateQuery);

  const failedUpdateQuery = dbQueries.filter(q => q.text.includes('UPDATE contributions') && q.params[0] === 'contrib-2');
  assert.equal(failedUpdateQuery.length, 0);

  // 3. Should send email only for successful one
  assert.equal(emailCalls.length, 1);
  assert.equal(emailCalls[0].to, 'email-user-key-1@test.com');
  assert.ok(emailCalls[0].text.includes('refunded'));
});

