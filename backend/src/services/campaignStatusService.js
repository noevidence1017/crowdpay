const db = require('../config/database');
const logger = require('../config/logger');
const sorobanService = require('./sorobanService');
const { sendEmail } = require('./emailService');

/**
 * Reconcile status for one campaign (active → funded or failed based on goal/deadline).
 */
async function refreshCampaignStatus(campaignId, client) {
  const runner = client || db;
  const { rows: failed } = await runner.query(
    `UPDATE campaigns
     SET status = 'failed'
     WHERE id = $1
       AND status = 'active'
       AND deadline IS NOT NULL
       AND deadline < CURRENT_DATE
       AND raised_amount < target_amount
     RETURNING id, title, target_amount, raised_amount, deadline, status, escrow_contract_id`,
    [campaignId]
  );

  const { rows: funded } = await runner.query(
    `UPDATE campaigns
     SET status = 'funded'
     WHERE id = $1
       AND status = 'active'
       AND raised_amount >= target_amount
     RETURNING id, title, target_amount, raised_amount, deadline, status, escrow_contract_id`,
    [campaignId]
  );

  if (failed[0]) {
    setImmediate(() => {
      processRefundsForCampaign(failed[0]).catch((err) => {
        logger.error('Background refund processing failed', { campaign_id: failed[0].id, error: err.message });
      });
    });
  }

  return {
    failed: failed[0] || null,
    funded: funded[0] || null,
  };
}

/**
 * Batch refresh for all still-active campaigns (hourly cron).
 */
async function refreshActiveCampaignStatuses() {
  const { rows: funded } = await db.query(
    `UPDATE campaigns
     SET status = 'funded'
     WHERE status = 'active'
       AND raised_amount >= target_amount
     RETURNING id, title, target_amount, raised_amount, deadline, status, escrow_contract_id`
  );

  const { rows: failed } = await db.query(
    `UPDATE campaigns
     SET status = 'failed'
     WHERE status = 'active'
       AND deadline IS NOT NULL
       AND deadline < CURRENT_DATE
       AND raised_amount < target_amount
     RETURNING id, title, target_amount, raised_amount, deadline, status, escrow_contract_id`
  );

  if (failed.length) {
    for (const campaign of failed) {
      setImmediate(() => {
        processRefundsForCampaign(campaign).catch((err) => {
          logger.error('Background refund processing failed', { campaign_id: campaign.id, error: err.message });
        });
      });
    }
  }

  if (funded.length || failed.length) {
    logger.info('Campaign status refresh completed', {
      funded_count: funded.length,
      failed_count: failed.length,
    });
  }

  return { funded, failed };
}

/**
 * Helper to retry refund operation with exponential backoff.
 */
async function refundWithRetry(escrowContractId, senderPublicKey, contributionId, maxRetries = 3) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      await sorobanService.refund(escrowContractId, senderPublicKey);
      return;
    } catch (err) {
      attempt++;
      if (attempt >= maxRetries) {
        throw err;
      }
      const delay = process.env.NODE_ENV === 'test' ? 1 : Math.pow(2, attempt) * 1000;
      logger.warn(`Refund attempt ${attempt} failed for contribution ${contributionId}. Retrying in ${delay}ms...`, { error: err.message });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Orchestrates Soroban contract refund execution for a campaign's contributions.
 */
async function processRefundsForCampaign(campaign, client) {
  const runner = client || db;
  const { rows: contributions } = await runner.query(
    `SELECT id, sender_public_key, amount, asset
     FROM contributions
     WHERE campaign_id = $1 AND refunded = FALSE`,
    [campaign.id]
  );

  for (const contribution of contributions) {
    try {
      await refundWithRetry(campaign.escrow_contract_id, contribution.sender_public_key, contribution.id);
      
      await runner.query(
        `UPDATE contributions
         SET refunded = TRUE
         WHERE id = $1`,
        [contribution.id]
      );

      const { rows: users } = await runner.query(
        `SELECT email, name FROM users WHERE wallet_public_key = $1`,
        [contribution.sender_public_key]
      );

      if (users.length && users[0].email) {
        await sendEmail({
          to: users[0].email,
          subject: `Refund processed for campaign "${campaign.title}"`,
          text: `Hi ${users[0].name || 'there'},\n\nYour contribution of ${contribution.amount} ${contribution.asset} to the campaign "${campaign.title}" has been refunded because the campaign did not meet its funding goal by the deadline.\n\nThank you for using CrowdPay.`,
        }).catch((emailErr) => {
          logger.error(`Failed to send refund email to ${users[0].email}:`, { error: emailErr.message });
        });
      }
    } catch (err) {
      logger.error(`Refund failed for contribution ${contribution.id}:`, { error: err.message });
    }
  }
}

module.exports = {
  refreshCampaignStatus,
  refreshActiveCampaignStatuses,
  processRefundsForCampaign,
};
