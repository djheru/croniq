import React, { useState } from 'react';
import { Button } from './ui';
import type { Job } from '../api';

const COLLECTOR_TYPES = ['html', 'browser', 'api', 'rss', 'graphql'] as const;

const EXAMPLE_CONFIGS: Record<string, object> = {
  html: {
    type: 'html',
    url: 'https://example.com',
    selectors: {
      title: 'h1',
      price: { selector: '.price', transform: 'number' },
      links: { selector: 'a', attribute: 'href', multiple: true },
    },
  },
  browser: {
    type: 'browser',
    url: 'https://example.com',
    waitFor: '.content',
    selectors: { title: 'h1', body: 'p' },
  },
  api: {
    type: 'api',
    url: 'https://api.example.com/data',
    method: 'GET',
    extract: 'data.items',
    transform: [{ from: 'name', to: 'name' }, { from: 'value', to: 'value', transform: 'number' }],
  },
  rss: {
    type: 'rss',
    url: 'https://feeds.example.com/rss.xml',
    maxItems: 10,
    fields: ['title', 'link', 'pubDate'],
  },
  graphql: {
    type: 'graphql',
    url: 'https://api.example.com/graphql',
    query: '{ items { id name value } }',
    extract: 'items',
  },
};

const CRON_PRESETS = [
  { label: 'Every 5 min',  value: '*/5 * * * *' },
  { label: 'Every 15 min', value: '*/15 * * * *' },
  { label: 'Every hour',   value: '0 * * * *' },
  { label: 'Every 6h',     value: '0 */6 * * *' },
  { label: 'Daily 9am',    value: '0 9 * * *' },
  { label: 'Weekly Mon',   value: '0 9 * * 1' },
];

interface JobFormProps {
  initial?: Partial<Job>;
  onSubmit: (data: object) => Promise<void>;
  onCancel: () => void;
}

export function JobForm({ initial, onSubmit, onCancel }: JobFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [schedule, setSchedule] = useState(initial?.schedule ?? '*/15 * * * *');
  const [collectorType, setCollectorType] = useState<string>(
    initial?.collectorConfig?.type ?? 'html'
  );
  const [configJson, setConfigJson] = useState(
    JSON.stringify(initial?.collectorConfig ?? EXAMPLE_CONFIGS.html, null, 2)
  );
  const [tags, setTags] = useState((initial?.tags ?? []).join(', '));
  const [notifyOnChange, setNotifyOnChange] = useState(initial?.notifyOnChange ?? false);
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhookUrl ?? '');
  const [retries, setRetries] = useState(initial?.retries ?? 2);
  const [timeoutMs, setTimeoutMs] = useState(initial?.timeoutMs ?? 30000);
  const [analysisPrompt, setAnalysisPrompt] = useState(initial?.analysisPrompt ?? '');
  const [analysisSchedule, setAnalysisSchedule] = useState(initial?.analysisSchedule ?? '0 * * * *');
  const [configError, setConfigError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function handleTypeChange(type: string) {
    setCollectorType(type);
    setConfigJson(JSON.stringify(EXAMPLE_CONFIGS[type] ?? {}, null, 2));
  }

  async function handleSubmit() {
    let collectorConfig;
    try {
      collectorConfig = JSON.parse(configJson);
      setConfigError('');
    } catch {
      setConfigError('Invalid JSON in collector config');
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        name, description, schedule, collectorConfig,
        outputFormat: 'json',
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        notifyOnChange,
        webhookUrl: webhookUrl || undefined,
        analysisPrompt: analysisPrompt || undefined,
        analysisSchedule: analysisSchedule || '0 * * * *',
        retries, timeoutMs,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'var(--text-1)',
    fontFamily: 'var(--font-mono)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
  };
  const fieldStyle: React.CSSProperties = { marginBottom: 16 };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ ...fieldStyle, gridColumn: '1 / -1' }}>
          <label style={labelStyle}>Job Name *</label>
          <input value={name} onChange={e => setName(e.target.value)}
            style={{ width: '100%' }} placeholder="e.g. BTC Price Monitor" />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)}
            style={{ width: '100%' }} placeholder="Optional description" />
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle}>Tags (comma-separated)</label>
          <input value={tags} onChange={e => setTags(e.target.value)}
            style={{ width: '100%' }} placeholder="prices, crypto, alerts" />
        </div>
      </div>

      {/* Schedule */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Cron Schedule *</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          {CRON_PRESETS.map(p => (
            <button key={p.value} onClick={() => setSchedule(p.value)} style={{
              padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
              background: schedule === p.value ? 'var(--accent-dim)' : 'var(--bg-3)',
              border: `1px solid ${schedule === p.value ? 'var(--accent)' : 'var(--border)'}`,
              color: schedule === p.value ? 'var(--accent)' : 'var(--text-1)',
              fontFamily: 'var(--font-mono)',
            }}>
              {p.label}
            </button>
          ))}
        </div>
        <input value={schedule} onChange={e => setSchedule(e.target.value)}
          style={{ width: '100%' }} placeholder="*/15 * * * *" />
      </div>

      {/* Collector type */}
      <div style={fieldStyle}>
        <label style={labelStyle}>Collector Type *</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {COLLECTOR_TYPES.map(t => (
            <button key={t} onClick={() => handleTypeChange(t)} style={{
              padding: '4px 12px', fontSize: 12, borderRadius: 4, cursor: 'pointer',
              background: collectorType === t ? 'var(--accent-dim)' : 'var(--bg-3)',
              border: `1px solid ${collectorType === t ? 'var(--accent)' : 'var(--border)'}`,
              color: collectorType === t ? 'var(--accent)' : 'var(--text-1)',
              fontFamily: 'var(--font-mono)',
            }}>
              {t}
            </button>
          ))}
        </div>

        <label style={labelStyle}>Collector Config (JSON) *</label>
        <textarea
          value={configJson}
          onChange={e => setConfigJson(e.target.value)}
          rows={12}
          style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
        />
        {configError && (
          <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{configError}</div>
        )}
      </div>

      {/* Advanced */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={fieldStyle}>
          <label style={labelStyle}>Retries on failure</label>
          <input type="number" min={0} max={5} value={retries}
            onChange={e => setRetries(parseInt(e.target.value))}
            style={{ width: '100%' }} />
        </div>
        <div style={fieldStyle}>
          <label style={labelStyle}>Timeout (ms)</label>
          <input type="number" min={1000} value={timeoutMs}
            onChange={e => setTimeoutMs(parseInt(e.target.value))}
            style={{ width: '100%' }} />
        </div>
      </div>

      <div style={fieldStyle}>
        <label style={labelStyle}>Webhook URL (on change)</label>
        <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
          style={{ width: '100%' }} placeholder="https://hooks.slack.com/..." />
      </div>

      <div style={{ ...fieldStyle, display: 'flex', alignItems: 'center', gap: 8 }}>
        <input type="checkbox" id="notify" checked={notifyOnChange}
          onChange={e => setNotifyOnChange(e.target.checked)} />
        <label htmlFor="notify" style={{ cursor: 'pointer', color: 'var(--text-1)', fontSize: 13 }}>
          Notify via webhook when result changes
        </label>
      </div>

      {/* Analysis */}
      <div style={{ borderTop: '1px solid var(--border)', marginTop: 16, paddingTop: 16 }}>
        <div style={{ ...fieldStyle }}>
          <label style={labelStyle}>Analysis Prompt (optional — enables LLM analysis)</label>
          <textarea
            value={analysisPrompt}
            onChange={e => setAnalysisPrompt(e.target.value)}
            rows={3}
            style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
            placeholder="e.g. Summarize the price trend. Is it trending up, down, or sideways?"
          />
        </div>

        {analysisPrompt && (
          <div style={fieldStyle}>
            <label style={labelStyle}>Analysis Schedule (cron)</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {[
                { label: 'Hourly', value: '0 * * * *' },
                { label: 'Every 6h', value: '0 */6 * * *' },
                { label: 'Daily 9am', value: '0 9 * * *' },
              ].map(p => (
                <button key={p.value} onClick={() => setAnalysisSchedule(p.value)} style={{
                  padding: '3px 10px', fontSize: 11, borderRadius: 4, cursor: 'pointer',
                  background: analysisSchedule === p.value ? 'var(--accent-dim)' : 'var(--bg-3)',
                  border: `1px solid ${analysisSchedule === p.value ? 'var(--accent)' : 'var(--border)'}`,
                  color: analysisSchedule === p.value ? 'var(--accent)' : 'var(--text-1)',
                  fontFamily: 'var(--font-mono)',
                }}>
                  {p.label}
                </button>
              ))}
            </div>
            <input value={analysisSchedule} onChange={e => setAnalysisSchedule(e.target.value)}
              style={{ width: '100%' }} placeholder="0 * * * *" />
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 8 }}>
        <Button onClick={onCancel} variant="ghost">Cancel</Button>
        <Button onClick={handleSubmit} variant="primary" disabled={submitting || !name}>
          {submitting ? 'Saving...' : initial?.id ? 'Update Job' : 'Create Job'}
        </Button>
      </div>
    </div>
  );
}
