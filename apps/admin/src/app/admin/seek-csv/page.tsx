'use client';

/**
 * Admin: Seek Questions — CSV Bulk Upload
 *
 * Access via: /admin/seek-csv
 *
 * CSV Format: keyword_id,user_name,question,insight_full,quote_short
 * - keyword_id: e.g. "mind-clarity"
 * - user_name: matches a name from Default Users (leaderboard_seeds) for avatar
 * - question: the seek question text (rows sharing the same keyword_id+user_name+question = 1 question)
 * - insight_full: full wisdom insight text for a card
 * - quote_short: short quote for the card front (max 60 chars)
 *
 * Example: 5 rows with same question → 1 question + 5 cards
 */

import { useRef, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';

import type { CsvRow, PreviewQuestion, Preview, UploadResult } from '@novame/core/types';
import { apiClient } from '@/lib/api-client';

export default function SeekCsvUploadPage() {
  const router = useRouter();
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Handle quoted CSV fields properly
  const parseCSVLine = (line: string): string[] => {
    const out: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === ',' && !inQuotes) {
        out.push(current);
        current = '';
        continue;
      }
      current += ch;
    }
    out.push(current);
    return out;
  };

  const parseCSV = (text: string): CsvRow[] => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      throw new Error('CSV must have a header row + at least 1 data row');
    }

    const header = parseCSVLine(lines[0]).map((h) =>
      h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '')
    );
    const requiredCols = ['keyword_id', 'user_name', 'question', 'insight_full', 'quote_short'];
    const missing = requiredCols.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      throw new Error(`Missing columns: ${missing.join(', ')}`);
    }

    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = parseCSVLine(lines[i]);
      if (vals.length < header.length) continue;
      const row: Record<string, string> = {};
      header.forEach((col, idx) => {
        row[col] = (vals[idx] || '').trim();
      });
      if (row.keyword_id && row.question) rows.push(row as CsvRow);
    }
    return rows;
  };

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setResult(null);
    setError(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = ev.target?.result;
        if (typeof text !== 'string') throw new Error('Failed to read file');
        const rows = parseCSV(text);
        setParsedRows(rows);

        // Build preview: group by question
        const groups: Record<string, PreviewQuestion> = {};
        for (const row of rows) {
          const key = `${row.keyword_id}|||${row.user_name}|||${row.question}`;
          if (!groups[key]) {
            groups[key] = {
              question: row.question,
              keyword_id: row.keyword_id,
              user_name: row.user_name,
              cardCount: 0,
            };
          }
          groups[key].cardCount++;
        }
        setPreview({ questions: Object.values(groups) });
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Parse error');
        setParsedRows([]);
        setPreview(null);
      }
    };
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (parsedRows.length === 0) return;
    setUploading(true);
    setResult(null);
    setError(null);

    try {
      const data = await apiClient.post<UploadResult>('/api/admin/seek-questions', {
        action: 'bulk_csv_upload',
        rows: parsedRows,
      });
      if (data.success) {
        setResult(data);
        setParsedRows([]);
        setPreview(null);
        setFileName('');
        if (fileRef.current) fileRef.current.value = '';
      } else {
        setError((data as { error?: string }).error || 'Upload failed');
      }
    } catch (err) {
      setError('Network error: ' + (err instanceof Error ? err.message : 'unknown'));
    }
    setUploading(false);
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0F0B2E',
        color: 'white',
        padding: '24px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        margin: '-24px -16px',
      }}
    >
      <div style={{ maxWidth: 800, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 32 }}>
          <button
            onClick={() => router.push('/admin')}
            style={{
              color: 'rgba(168,85,247,0.7)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontSize: 14,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              padding: 0,
            }}
          >
            ← Back to Admin
          </button>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginTop: 12 }}>
            Seek Questions — CSV Bulk Upload
          </h1>
          <p
            style={{
              color: 'rgba(255,255,255,0.5)',
              fontSize: 14,
              marginTop: 8,
              lineHeight: 1.6,
            }}
          >
            Upload a CSV to batch-create seek questions with pre-filled wisdom cards.
            Cards will appear in both Discover → Seek (under the question) and Discover → Gallery.
          </p>
        </div>

        {/* CSV Format Guide */}
        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 16,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <h3
            style={{
              fontSize: 14,
              fontWeight: 700,
              marginBottom: 12,
              color: 'rgba(168,85,247,0.9)',
            }}
          >
            CSV Format
          </h3>
          <div
            style={{
              background: 'rgba(0,0,0,0.3)',
              borderRadius: 8,
              padding: 14,
              fontFamily: 'monospace',
              fontSize: 12,
              lineHeight: 1.8,
              overflowX: 'auto',
              color: 'rgba(255,255,255,0.7)',
            }}
          >
            <div style={{ color: '#A855F7' }}>
              keyword_id,user_name,question,insight_full,quote_short
            </div>
            <div>
              mind-clarity,DaphneMoon,What is the key...?,We often miss...,Clarity begins within
            </div>
            <div>
              mind-clarity,DaphneMoon,What is the key...?,Social expectations...,You find your truth
            </div>
          </div>
          <p
            style={{
              color: 'rgba(255,255,255,0.35)',
              fontSize: 12,
              marginTop: 10,
              lineHeight: 1.5,
            }}
          >
            Rows sharing the same <b>keyword_id + user_name + question</b> produce 1 question with multiple cards.
            <br />
            user_name is matched against Default Users for avatar display.
          </p>
        </div>

        {/* File Upload */}
        <div style={{ marginBottom: 24 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              background: 'rgba(168,85,247,0.1)',
              border: '2px dashed rgba(168,85,247,0.3)',
              borderRadius: 16,
              padding: '40px 24px',
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <span style={{ fontSize: 32 }}>📄</span>
            <div>
              <p style={{ fontWeight: 700, fontSize: 15 }}>
                {fileName || 'Choose CSV file'}
              </p>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                Click or drag to select
              </p>
            </div>
          </label>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 12,
              padding: 16,
              marginBottom: 24,
            }}
          >
            <p style={{ color: '#EF4444', fontSize: 14 }}>❌ {error}</p>
          </div>
        )}

        {/* Preview */}
        {preview && (
          <div style={{ marginBottom: 24 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>
              Preview: {preview.questions.length} question
              {preview.questions.length !== 1 ? 's' : ''}, {parsedRows.length} card
              {parsedRows.length !== 1 ? 's' : ''} total
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {preview.questions.map((q, i) => (
                <div
                  key={i}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 12,
                    padding: 16,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 8,
                    }}
                  >
                    <span
                      style={{
                        background: 'rgba(168,85,247,0.2)',
                        color: '#C084FC',
                        padding: '2px 10px',
                        borderRadius: 8,
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {q.keyword_id}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>
                      by {q.user_name}
                    </span>
                  </div>
                  <p style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>
                    {q.question}
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12 }}>
                    {q.cardCount} wisdom card{q.cardCount !== 1 ? 's' : ''}
                  </p>
                </div>
              ))}
            </div>

            {/* Raw data table */}
            <details style={{ marginTop: 16 }}>
              <summary
                style={{
                  color: 'rgba(255,255,255,0.4)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Show raw rows ({parsedRows.length})
              </summary>
              <div style={{ overflowX: 'auto', marginTop: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['#', 'keyword_id', 'user_name', 'question', 'insight_full', 'quote_short'].map(
                        (h) => (
                          <th
                            key={h}
                            style={{
                              textAlign: 'left',
                              padding: '8px 6px',
                              borderBottom: '1px solid rgba(255,255,255,0.1)',
                              color: 'rgba(255,255,255,0.5)',
                              fontWeight: 600,
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.slice(0, 50).map((row, i) => (
                      <tr key={i}>
                        <td style={{ padding: '6px', color: 'rgba(255,255,255,0.3)' }}>
                          {i + 1}
                        </td>
                        <td style={{ padding: '6px', color: '#C084FC', whiteSpace: 'nowrap' }}>
                          {row.keyword_id}
                        </td>
                        <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>
                          {row.user_name}
                        </td>
                        <td
                          style={{
                            padding: '6px',
                            maxWidth: 180,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {row.question}
                        </td>
                        <td
                          style={{
                            padding: '6px',
                            maxWidth: 200,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'rgba(255,255,255,0.6)',
                          }}
                        >
                          {row.insight_full}
                        </td>
                        <td
                          style={{
                            padding: '6px',
                            maxWidth: 140,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: 'rgba(255,255,255,0.6)',
                          }}
                        >
                          {row.quote_short}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedRows.length > 50 && (
                  <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 8 }}>
                    Showing first 50 of {parsedRows.length} rows
                  </p>
                )}
              </div>
            </details>

            {/* Upload button */}
            <button
              onClick={handleUpload}
              disabled={uploading || parsedRows.length === 0}
              style={{
                marginTop: 20,
                width: '100%',
                padding: '16px 24px',
                borderRadius: 16,
                border: 'none',
                background: uploading
                  ? 'rgba(168,85,247,0.3)'
                  : 'linear-gradient(135deg, #A855F7, #7C3AED)',
                color: 'white',
                fontWeight: 700,
                fontSize: 15,
                cursor: uploading ? 'wait' : 'pointer',
                boxShadow: '0 4px 20px rgba(168,85,247,0.4)',
              }}
            >
              {uploading
                ? '⏳ Uploading...'
                : `Upload ${preview.questions.length} Question${
                    preview.questions.length !== 1 ? 's' : ''
                  } + ${parsedRows.length} Card${parsedRows.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        )}

        {/* Result */}
        {result && (
          <div
            style={{
              background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: 16,
              padding: 20,
              marginBottom: 24,
            }}
          >
            <h3 style={{ color: '#22C55E', fontWeight: 700, fontSize: 16, marginBottom: 12 }}>
              ✅ Upload Complete
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 12,
              }}
            >
              <div
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 10,
                  padding: 14,
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: 28, fontWeight: 800 }}>
                  {result.summary?.questions || 0}
                </p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  Questions
                </p>
              </div>
              <div
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 10,
                  padding: 14,
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: 28, fontWeight: 800 }}>
                  {result.summary?.cards || 0}
                </p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  Cards
                </p>
              </div>
              <div
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: 10,
                  padding: 14,
                  textAlign: 'center',
                }}
              >
                <p
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    color: (result.summary?.errors || 0) > 0 ? '#EF4444' : '#22C55E',
                  }}
                >
                  {result.summary?.errors || 0}
                </p>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)' }}>
                  Errors
                </p>
              </div>
            </div>
            {result.errors && result.errors.length > 0 && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: 'rgba(239,68,68,0.1)',
                  borderRadius: 8,
                }}
              >
                {result.errors.map((e, i) => (
                  <p key={i} style={{ fontSize: 12, color: '#EF4444', marginBottom: 4 }}>
                    {e}
                  </p>
                ))}
              </div>
            )}
            <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 12 }}>
              Questions are now live in Discover → Seek. Cards also appear in Discover → Gallery.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
