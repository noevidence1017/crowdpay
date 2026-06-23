import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';

const DISPUTE_STATUSES = ['open', 'under_review', 'resolved_creator', 'resolved_contributor', 'closed'];

function DisputeQueue() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    // Load open/under_review disputes across all campaigns via admin endpoint
    api.getAdminCampaigns()
      .then(async (campaigns) => {
        const all = await Promise.all(
          campaigns.map((c) =>
            api.getCampaignDisputes(c.id)
              .then((ds) => ds.map((d) => ({ ...d, campaign_title: c.title })))
              .catch(() => [])
          )
        );
        setDisputes(all.flat().sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
      })
      .finally(() => setLoading(false));
  }, []);

  async function resolve(dispute, status) {
    const note = window.prompt(`Resolution note (${status}):`, '');
    if (note === null) return;
    setBusyId(dispute.id);
    try {
      const updated = await api.updateDispute(dispute.id, { status, resolution_note: note || undefined });
      setDisputes((prev) => prev.map((d) => (d.id === updated.id ? { ...d, ...updated } : d)));
    } catch (err) {
      alert(err.message || 'Could not update dispute');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p style={{ color: 'var(--color-text-hint)' }}>Loading disputes…</p>;
  if (!disputes.length) return <p style={{ color: 'var(--color-text-hint)', marginBottom: '2rem' }}>No disputes on record.</p>;

  return (
    <div style={{ display: 'grid', gap: '0.9rem', marginBottom: '2.5rem' }}>
      {disputes.map((d) => (
        <div
          key={d.id}
          style={{
            border: '1px solid var(--color-border-light)',
            borderRadius: '12px',
            padding: '1rem',
            background: 'var(--color-bg)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div>
              <strong>{d.campaign_title}</strong>
              <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--color-text-hint)' }}>
                #{d.id}
              </span>
            </div>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.2rem 0.6rem',
                borderRadius: '999px',
                background: 'var(--color-accent-soft)',
                color: 'var(--color-accent)',
              }}
            >
              {d.status}
            </span>
          </div>

          <p style={{ margin: '0.5rem 0', fontSize: '0.9rem' }}>{d.reason}</p>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
            {DISPUTE_STATUSES.filter((s) => s !== d.status).map((s) => (
              <button
                key={s}
                disabled={busyId === d.id}
                onClick={() => resolve(d, s)}
                style={{
                  fontSize: '0.75rem',
                  padding: '0.25rem 0.7rem',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border-light)',
                  background: 'var(--color-bg-secondary)',
                  cursor: 'pointer',
                  opacity: busyId === d.id ? 0.5 : 1,
                }}
              >
                → {s}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function MilestoneApprovalQueue() {
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  function load() {
    setLoading(true);
    api.getAdminMilestones({ status: 'pending_review' })
      .then(setMilestones)
      .catch(() => setMilestones([]))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function approve(milestone) {
    if (!window.confirm(`Approve and release funds for "${milestone.title}"?`)) return;
    setBusyId(milestone.id);
    try {
      await api.approveMilestone(milestone.id);
      load();
    } catch (err) {
      alert(err.message || 'Could not approve milestone');
    } finally {
      setBusyId(null);
    }
  }

  async function reject(milestone) {
    const reason = rejectReason.trim();
    if (!reason) {
      alert('A rejection reason is required.');
      return;
    }
    setBusyId(milestone.id);
    try {
      await api.rejectMilestone(milestone.id, { reason });
      setRejectingId(null);
      setRejectReason('');
      load();
    } catch (err) {
      alert(err.message || 'Could not reject milestone');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p style={{ color: 'var(--color-text-hint)' }}>Loading milestone queue…</p>;
  if (!milestones.length) {
    return (
      <p style={{ color: 'var(--color-text-hint)', marginBottom: '2.5rem' }}>
        No milestones awaiting evidence review.
      </p>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '0.9rem', marginBottom: '2.5rem' }}>
      {milestones.map((m) => (
        <div
          key={m.id}
          style={{
            border: '1px solid var(--color-border-light)',
            borderRadius: '12px',
            padding: '1rem',
            background: 'var(--color-bg)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
            <div>
              <strong>{m.title}</strong>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-text-hint)', marginTop: '0.2rem' }}>
                {m.campaign_title} · {m.creator_name || m.creator_email}
              </div>
            </div>
            <span
              style={{
                fontSize: '0.75rem',
                padding: '0.2rem 0.6rem',
                borderRadius: '999px',
                background: 'var(--color-warning-bg)',
                color: 'var(--color-warning-text)',
              }}
            >
              pending review
            </span>
          </div>

          {m.evidence_description && (
            <p style={{ margin: '0.65rem 0 0', fontSize: '0.9rem' }}>{m.evidence_description}</p>
          )}

          {m.evidence_url && (
            <p style={{ margin: '0.45rem 0 0', fontSize: '0.85rem' }}>
              Evidence:{' '}
              <a href={m.evidence_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-accent)' }}>
                View proof
              </a>
            </p>
          )}

          <div style={{ marginTop: '0.45rem', fontSize: '0.82rem', color: 'var(--color-text-hint)' }}>
            Release: {Number(m.release_percentage).toLocaleString()}% · Destination:{' '}
            <code>{m.destination_key?.slice(0, 8)}…</code>
            {m.evidence_submitted_at && (
              <span> · Submitted {new Date(m.evidence_submitted_at).toLocaleString()}</span>
            )}
          </div>

          {rejectingId === m.id ? (
            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Rejection reason (visible to creator)"
                rows={2}
                style={{
                  fontSize: '0.85rem',
                  resize: 'vertical',
                  padding: '0.5rem',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border-light)',
                  fontFamily: 'inherit',
                }}
                autoFocus
              />
              <div style={{ display: 'flex', gap: '0.45rem' }}>
                <button
                  type="button"
                  disabled={busyId === m.id}
                  onClick={() => reject(m)}
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.35rem 0.8rem',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border-light)',
                    background: 'var(--color-error-bg)',
                    color: 'var(--color-error-text)',
                    cursor: 'pointer',
                  }}
                >
                  Confirm reject
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRejectingId(null);
                    setRejectReason('');
                  }}
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.35rem 0.8rem',
                    borderRadius: '6px',
                    border: '1px solid var(--color-border-light)',
                    background: 'var(--color-bg-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
              <button
                type="button"
                disabled={busyId === m.id}
                onClick={() => approve(m)}
                style={{
                  fontSize: '0.75rem',
                  padding: '0.35rem 0.8rem',
                  borderRadius: '6px',
                  border: '1px solid #86efac',
                  background: '#dcfce7',
                  color: '#166534',
                  cursor: 'pointer',
                }}
              >
                {busyId === m.id ? 'Approving…' : 'Approve & release'}
              </button>
              <button
                type="button"
                disabled={busyId === m.id}
                onClick={() => setRejectingId(m.id)}
                style={{
                  fontSize: '0.75rem',
                  padding: '0.35rem 0.8rem',
                  borderRadius: '6px',
                  border: '1px solid var(--color-border-light)',
                  background: 'var(--color-bg-secondary)',
                  cursor: 'pointer',
                }}
              >
                Reject
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CampaignsQueue() {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, []);

  function load() {
    api.getAdminCampaigns()
      .then(setCampaigns)
      .finally(() => setLoading(false));
  }

  async function feature(id) {
    const note = window.prompt('Featured note (optional):', '');
    if (note === null) return;
    try {
      await api.adminFeatureCampaign(id, { note });
      load();
    } catch (err) {
      alert(err.message || 'Could not feature campaign');
    }
  }

  async function unfeature(id) {
    if (!window.confirm('Remove from featured?')) return;
    try {
      await api.adminUnfeatureCampaign(id);
      load();
    } catch (err) {
      alert(err.message || 'Could not unfeature campaign');
    }
  }

  if (loading) return <p style={{ color: 'var(--color-text-hint)' }}>Loading campaigns…</p>;

  return (
    <div style={{ display: 'grid', gap: '0.9rem', marginBottom: '2.5rem' }}>
      {campaigns.map((c) => (
        <div
          key={c.id}
          style={{
            border: '1px solid var(--color-border-light)',
            borderRadius: '12px',
            padding: '1rem',
            background: 'var(--color-bg)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>{c.title}</strong>
              <span style={{ marginLeft: '0.5rem', fontSize: '0.8rem', color: 'var(--color-text-hint)' }}>
                #{c.id}
              </span>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                onClick={() => feature(c.id)}
                style={{
                  fontSize: '0.75rem', padding: '0.25rem 0.7rem', borderRadius: '6px',
                  border: '1px solid #fde047', background: '#fef9c3', color: '#854d0e', cursor: 'pointer'
                }}
              >
                ⭐️ Feature
              </button>
              <button
                onClick={() => unfeature(c.id)}
                style={{
                  fontSize: '0.75rem', padding: '0.25rem 0.7rem', borderRadius: '6px',
                  border: '1px solid var(--color-border-light)', background: 'var(--color-bg-secondary)', cursor: 'pointer'
                }}
              >
                Unfeature
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}


export default function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/');
    }
  }, [user, navigate]);

  return (
    <div style={{ maxWidth: '860px', margin: '2rem auto', padding: '0 1rem' }}>
      <h1 style={{ marginBottom: '1.5rem' }}>Admin Dashboard</h1>

      <h2 style={{ marginBottom: '1rem' }}>Milestone approvals</h2>
      <MilestoneApprovalQueue />

      <h2 style={{ marginBottom: '1rem', marginTop: '2rem' }}>Campaigns</h2>
      <CampaignsQueue />

      <h2 style={{ marginBottom: '1rem', marginTop: '2rem' }}>Dispute Queue</h2>
      <DisputeQueue />
    </div>
  );
}