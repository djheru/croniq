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

const DEFAULT_PROMPTS: Record<string, string> = {
  html: 'Extract the main content from this page using the configured selectors. Identify key data points, flag any missing or empty fields, and note if the page structure appears to have changed since previous runs.',
  browser: 'Load this JavaScript-rendered page and extract content using the configured selectors. Wait for dynamic content to fully render before collecting. Note any loading errors, missing elements, or significant layout changes.',
  api: 'Fetch data from this API endpoint. Validate the response structure, extract the relevant fields, and summarize the key data points. Flag any unexpected status codes, missing fields, or schema changes compared to previous runs.',
  rss: 'Collect the latest entries from this feed. Summarize each item briefly, identify any new or notable entries since the last run, and highlight trending topics or significant changes in posting frequency.',
  graphql: 'Execute the configured GraphQL query and extract the requested data. Validate that all expected fields are present in the response. Summarize the results and flag any null fields or errors returned by the API.',
};

const PROMPT_EXAMPLES: Record<string, string[]> = {
  html: [
    'Scrape product prices and availability, flag any items that dropped below $50',
    'Extract all job listings, capture title, company, salary range, and posting date',
    'Collect news headlines and article summaries from the front page',
  ],
  browser: [
    'Wait for the dashboard to load, then capture all KPI values and their trend indicators',
    'Scrape dynamically-loaded search results including pagination, extract titles and URLs',
    'Capture the live leaderboard data after the JavaScript table finishes rendering',
  ],
  api: [
    'Fetch current crypto prices for BTC, ETH, SOL — include 24h change percentages and volume',
    'Pull the latest weather forecast for {{zip}} and flag any severe weather alerts',
    'Collect server health metrics and flag any services reporting degraded status',
  ],
  rss: [
    'Monitor for new security advisories, prioritize any rated Critical or High severity',
    'Track new blog posts about AI/ML, summarize each and note key takeaways',
    'Watch for new podcast episodes, list titles and publication dates',
  ],
  graphql: [
    'Query open issues labeled "bug" and summarize by severity and assignee',
    'Fetch the latest deployment statuses and flag any failed or rollback events',
    'Pull repository stats including stars, forks, and recent commit activity',
  ],
};

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
  const [jobPrompt, setJobPrompt] = useState(
    initial?.jobPrompt ?? (initial?.id ? '' : DEFAULT_PROMPTS[initial?.collectorConfig?.type ?? 'html'] ?? '')
  );
  const [jobParams, setJobParams] = useState<Record<string, string>>(initial?.jobParams ?? {});
  const [configError, setConfigError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDataSource, setShowDataSource] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);

  function handleTypeChange(type: string) {
    setCollectorType(type);
    setConfigJson(JSON.stringify(EXAMPLE_CONFIGS[type] ?? {}, null, 2));
    // Auto-fill prompt if empty or still set to a previous type's default
    const isDefault = !jobPrompt || Object.values(DEFAULT_PROMPTS).includes(jobPrompt);
    if (isDefault) {
      setJobPrompt(DEFAULT_PROMPTS[type] ?? '');
    }
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
        jobPrompt: jobPrompt || undefined,
        jobParams: Object.keys(jobParams).length > 0 ? jobParams : undefined,
        retries, timeoutMs,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const sectionLabel: React.CSSProperties = {
    fontSize: 11, color: 'var(--text-1)', fontFamily: 'var(--font-mono)',
    textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600,
  };
  const fieldLabel: React.CSSProperties = {
    display: 'block', fontSize: 11, color: 'var(--text-1)',
    fontFamily: 'var(--font-mono)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em',
  };
  const fieldBox: React.CSSProperties = { marginBottom: 16 };
  const sectionStyle: React.CSSProperties = {
    borderTop: '1px solid var(--border)', marginTop: 20, paddingTop: 16,
  };
  const toggleButton: React.CSSProperties = {
    background: 'none', border: 'none', color: 'var(--accent)',
    cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font-mono)',
    padding: 0, display: 'flex', alignItems: 'center', gap: 6,
  };

  return (
    <div>
      {/* ── Identity ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ ...fieldBox, gridColumn: '1 / -1' }}>
          <label style={fieldLabel}>Job Name *</label>
          <input value={name} onChange={e => setName(e.target.value)}
            style={{ width: '100%' }} placeholder="e.g. BTC Price Monitor" />
        </div>
        <div style={fieldBox}>
          <label style={fieldLabel}>Description</label>
          <input value={description} onChange={e => setDescription(e.target.value)}
            style={{ width: '100%' }} placeholder="Optional description" />
        </div>
        <div style={fieldBox}>
          <label style={fieldLabel}>Tags (comma-separated)</label>
          <input value={tags} onChange={e => setTags(e.target.value)}
            style={{ width: '100%' }} placeholder="prices, crypto, alerts" />
        </div>
      </div>

      {/* ── Agent Prompt ── */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={sectionLabel}>Agent Instructions</span>
          <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--font-mono)' }}>
            Guides the 4-stage AI pipeline
          </span>
        </div>
        <div style={fieldBox}>
          <label style={fieldLabel}>
            Job Prompt *
          </label>
          <textarea
            value={jobPrompt}
            onChange={e => setJobPrompt(e.target.value)}
            rows={4}
            style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
            placeholder="Tell the agent what to collect, what to look for, and how to analyze it..."
          />
          <div style={{ marginTop: 6 }}>
            <span style={{ fontSize: 10, color: 'var(--text-2)', display: 'block', marginBottom: 4 }}>
              Examples for {collectorType} — click to use:
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(PROMPT_EXAMPLES[collectorType] ?? []).map((ex, i) => (
                <button key={i} onClick={() => setJobPrompt(ex)} style={{
                  background: 'var(--bg-3)', border: '1px solid var(--border)',
                  borderRadius: 4, padding: '4px 10px', fontSize: 11,
                  color: 'var(--text-1)', cursor: 'pointer', textAlign: 'left',
                  fontFamily: 'var(--font-mono)', lineHeight: 1.4,
                }}>
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Template params */}
        {jobPrompt.includes('{{') && (
          <div style={fieldBox}>
            <label style={fieldLabel}>Template Parameters</label>
            <span style={{ fontSize: 10, color: 'var(--text-2)', display: 'block', marginBottom: 8 }}>
              Define values for {'{{key}}'} placeholders in your prompt
            </span>
            {Object.entries(jobParams).map(([key, value]) => (
              <div key={key} style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
                <input
                  value={key}
                  onChange={e => {
                    const newParams = { ...jobParams };
                    delete newParams[key];
                    newParams[e.target.value] = value;
                    setJobParams(newParams);
                  }}
                  style={{ width: 120, fontSize: 12 }}
                  placeholder="key"
                />
                <input
                  value={value}
                  onChange={e => setJobParams({ ...jobParams, [key]: e.target.value })}
                  style={{ flex: 1, fontSize: 12 }}
                  placeholder="value"
                />
                <Button size="sm" variant="danger" onClick={() => {
                  const newParams = { ...jobParams };
                  delete newParams[key];
                  setJobParams(newParams);
                }}>✕</Button>
              </div>
            ))}
            <Button size="sm" variant="ghost" onClick={() => {
              setJobParams({ ...jobParams, ['']: '' });
            }}>+ Add param</Button>
          </div>
        )}
      </div>

      {/* ── Schedule ── */}
      <div style={sectionStyle}>
        <span style={{ ...sectionLabel, display: 'block', marginBottom: 12 }}>Schedule</span>
        <div style={fieldBox}>
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
      </div>

      {/* ── Data Source ── */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showDataSource ? 12 : 0 }}>
          <span style={sectionLabel}>Data Source</span>
          <button onClick={() => setShowDataSource(!showDataSource)} style={toggleButton}>
            {showDataSource ? '▾ Hide' : '▸ Configure'}
          </button>
        </div>

        {showDataSource && (
          <>
            <div style={fieldBox}>
              <label style={fieldLabel}>Source Type *</label>
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

              <label style={fieldLabel}>Source Config (JSON) *</label>
              <textarea
                value={configJson}
                onChange={e => setConfigJson(e.target.value)}
                rows={10}
                style={{ width: '100%', resize: 'vertical', fontSize: 12 }}
              />
              {configError && (
                <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 4 }}>{configError}</div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Advanced ── */}
      <div style={sectionStyle}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: showAdvanced ? 12 : 0 }}>
          <span style={sectionLabel}>Advanced</span>
          <button onClick={() => setShowAdvanced(!showAdvanced)} style={toggleButton}>
            {showAdvanced ? '▾ Hide' : '▸ Show'}
          </button>
        </div>

        {showAdvanced && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div style={fieldBox}>
                <label style={fieldLabel}>Retries on failure</label>
                <input type="number" min={0} max={5} value={retries}
                  onChange={e => setRetries(parseInt(e.target.value))}
                  style={{ width: '100%' }} />
              </div>
              <div style={fieldBox}>
                <label style={fieldLabel}>Timeout (ms)</label>
                <input type="number" min={1000} value={timeoutMs}
                  onChange={e => setTimeoutMs(parseInt(e.target.value))}
                  style={{ width: '100%' }} />
              </div>
            </div>

            <div style={fieldBox}>
              <label style={fieldLabel}>Webhook URL (on change)</label>
              <input value={webhookUrl} onChange={e => setWebhookUrl(e.target.value)}
                style={{ width: '100%' }} placeholder="https://hooks.slack.com/..." />
            </div>

            <div style={{ ...fieldBox, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" id="notify" checked={notifyOnChange}
                onChange={e => setNotifyOnChange(e.target.checked)} />
              <label htmlFor="notify" style={{ cursor: 'pointer', color: 'var(--text-1)', fontSize: 13 }}>
                Notify via webhook when result changes
              </label>
            </div>
          </>
        )}
      </div>

      {/* ── Actions ── */}
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', paddingTop: 16, marginTop: 8 }}>
        <Button onClick={onCancel} variant="ghost">Cancel</Button>
        <Button onClick={handleSubmit} variant="primary" disabled={submitting || !name}>
          {submitting ? 'Saving...' : initial?.id ? 'Update Job' : 'Create Job'}
        </Button>
      </div>
    </div>
  );
}
