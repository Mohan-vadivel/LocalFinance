import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Download, FileUp, ListChecks, Upload } from 'lucide-react';
import { IMPORT_FIELDS, IMPORT_MAX_ROWS, IMPORT_REQUIRED, importDate, type ImportField } from '@localfinance/shared';
import { BranchPicker, FundPicker, ProductPicker, RoutePicker, clearLookups } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Field, Stat, useToast } from '../components/ui';
import { post } from '../lib/api';
import { dateIN, money } from '../lib/format';

type Cell = string | number;
interface Issue { code: string; field?: string; params?: Record<string, string | number>; message: string }
interface PreviewRow {
  rowNo: number;
  accountNo: string | null;
  name: string | null;
  phone: string | null;
  line: string | null;
  status: 'NEW' | 'EXISTS' | 'CLOSED' | 'ERROR' | 'IMPORTED';
  errors: Issue[];
  warnings: Issue[];
  customer: { action: 'CREATE' | 'REUSE' | 'SAME_AS_ROW'; code: string | null; name: string } | null;
  existingLoan: { id: string; number: string } | null;
  loan?: { id: string; number: string } | null;
  customerCode?: string | null;
  principal: number | null;
  totalPayable: number | null;
  paid: number | null;
  balance: number | null;
  instalment: number | null;
  tenure: number | null;
  loanDate: string | null;
  maturityDate: string | null;
}
interface Summary { rows: number; newLoans: number; newCustomers: number; reusedCustomers: number; existing: number; closed: number; errors: number; warnings: number; principal: number; totalPayable: number; paid: number; balance: number; imported?: number }
interface Result { summary: Summary; rows: PreviewRow[] }

/**
 * Header names seen in old desk software exports and hand-made sheets, in English, common abbreviations and Tamil.
 * Compared after lower-casing and removing spaces and punctuation ("A/c No" → "acno").
 */
const SYNONYMS: Record<ImportField, string[]> = {
  accountNo: ['acno', 'accno', 'acctno', 'accountno', 'accountnumber', 'account', 'loanno', 'loanacno', 'ano', 'cardno', 'கணக்குஎண்', 'கணக்கு', 'எண்'],
  name: ['name', 'customername', 'custname', 'customer', 'borrower', 'borrowername', 'partyname', 'englishname', 'nameenglish', 'பெயர்', 'வாடிக்கையாளர்பெயர்', 'வாடிக்கையாளர்'],
  nameTamil: ['tamilname', 'nametamil', 'nameintamil', 'தமிழ்பெயர்', 'பெயர்தமிழ்'],
  phone: ['phone', 'phoneno', 'mobile', 'mobileno', 'mob', 'mobno', 'cell', 'cellno', 'contact', 'contactno', 'ph', 'phno', 'கைபேசி', 'தொலைபேசி', 'போன்', 'அலைபேசி'],
  altPhone: ['altphone', 'alternatephone', 'phone2', 'mobile2', 'altmobile', 'otherphone'],
  address: ['address', 'addr', 'street', 'place', 'முகவரி', 'ஊர்'],
  occupation: ['profession', 'occupation', 'work', 'job', 'business', 'தொழில்'],
  idNumber: ['aadhaar', 'aadhar', 'aadharno', 'aadhaarno', 'idno', 'idnumber', 'idproof', 'ஆதார்'],
  line: ['line', 'lineno', 'linename', 'route', 'routename', 'area', 'லைன்', 'வரிசை', 'பகுதி'],
  loanAmount: ['loanamt', 'loanamount', 'amount', 'amt', 'principal', 'loan', 'givenamt', 'கடன்தொகை', 'கடன்', 'தொகை'],
  totalPayable: ['totalpayable', 'totalamt', 'totalamount', 'total', 'payable', 'payableamt', 'netamt', 'collectionamt', 'மொத்தம்', 'மொத்ததொகை'],
  loanDate: ['loandate', 'date', 'issuedate', 'givendate', 'disbdate', 'disbursedon', 'startdate', 'ldate', 'தேதி', 'கடன்தேதி'],
  instalment: ['instamt', 'inst', 'instalment', 'installment', 'instalmentamt', 'installmentamt', 'dailyamt', 'weeklyamt', 'dueamt', 'emi', 'தவணை', 'தவணைத்தொகை'],
  tenure: ['noofinst', 'noofinstalments', 'noofdays', 'days', 'tenure', 'period', 'weeks', 'months', 'totalinst', 'நாட்கள்', 'தவணைகள்'],
  firstDueDate: ['firstdue', 'firstduedate', 'duefrom', 'collectionstart'],
  maturityDate: ['maturitydate', 'maturity', 'matdate', 'enddate', 'closedate', 'lastdate', 'duedate', 'முடிவுதேதி'],
  received: ['rcvdamt', 'rcvd', 'received', 'receivedamt', 'recdamt', 'recd', 'paid', 'paidamt', 'collected', 'collamt', 'amtreceived', 'வரவு', 'செலுத்தியது', 'பெற்றது', 'வசூல்'],
  balance: ['loanbal', 'balance', 'bal', 'balamt', 'balanceamt', 'outstanding', 'pending', 'due', 'நிலுவை', 'பாக்கி', 'மீதி'],
};
const norm = (h: unknown) => String(h ?? '').toLowerCase().replace(/[^a-z0-9஀-௿]/g, '');

/** Best column for each field: exact header names first, then headers that contain a known name. */
function guessMapping(headers: unknown[]): Record<ImportField, number> {
  const cands: { field: ImportField; col: number; score: number }[] = [];
  headers.forEach((h, col) => {
    const n = norm(h);
    if (!n) return;
    for (const field of IMPORT_FIELDS) {
      let score = 0;
      for (const s of SYNONYMS[field]) {
        if (n === s) score = Math.max(score, 100 + s.length);
        else if (s.length >= 3 && n.includes(s)) score = Math.max(score, s.length);
      }
      if (score) cands.push({ field, col, score });
    }
  });
  cands.sort((a, b) => b.score - a.score);
  const map = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, -1])) as Record<ImportField, number>;
  const used = new Set<number>();
  for (const c of cands) {
    if (map[c.field] !== -1 || used.has(c.col)) continue;
    map[c.field] = c.col;
    used.add(c.col);
  }
  return map;
}

/** The header row: among the first rows, the one whose cells look most like known headers (exports often start with a title). */
function findHeaderRow(grid: Cell[][]): number {
  let best = 0;
  let bestScore = 0;
  grid.slice(0, 15).forEach((row, i) => {
    const m = guessMapping(row);
    const score = Object.values(m).filter((c) => c >= 0).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return best;
}

const TEMPLATE_HEADERS = ['A/c No', 'Name', 'Tamil Name', 'Phone', 'Address', 'Profession', 'Line', 'Loan Amt', 'Total Payable', 'Loan Date', 'Inst Amt', 'No of Inst', 'Maturity Date', 'Rcvd Amt', 'Loan Bal'];

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    TEMPLATE_HEADERS,
    ['101', 'Murugan', 'முருகன்', '9876543210', '12, Gandhi Street', 'Vegetable vendor', '', 10000, 12000, '05-09-2026', 120, 100, '', 3600, 8400],
    ['102', 'Valli', 'வள்ளி', '9876543211', '3, Temple Road', 'Tailor', '', 5000, 6000, '20-09-2026', 60, 100, '', '', 5400],
  ]);
  ws['!cols'] = TEMPLATE_HEADERS.map((h) => ({ wch: Math.max(10, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Loans');
  XLSX.writeFile(wb, 'localfinance-import-template.xlsx');
}

async function readSheet(file: File): Promise<XLSX.WorkBook> {
  if (/\.csv$/i.test(file.name)) {
    // Read CSV as text so Tamil stays intact, and keep dates as typed (no US month/day guessing).
    return XLSX.read(await file.text(), { type: 'string', raw: true });
  }
  return XLSX.read(await file.arrayBuffer(), { type: 'array' });
}

/** All rows of a sheet, blank ones kept so positions match the sheet; `first` is the sheet row number of grid[0]. */
function sheetGrid(wb: XLSX.WorkBook, name: string): { grid: Cell[][]; first: number } {
  const ws = wb.Sheets[name];
  if (!ws || !ws['!ref']) return { grid: [], first: 1 };
  const grid = XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, raw: true, defval: '', blankrows: true });
  return { grid, first: XLSX.utils.decode_range(ws['!ref']).s.r + 1 };
}
const DATE_FIELDS: ImportField[] = ['loanDate', 'firstDueDate', 'maturityDate'];

const statusTone = (s: PreviewRow['status']) => (({ NEW: 'brand', IMPORTED: 'ok', EXISTS: undefined, CLOSED: undefined, ERROR: 'danger' }) as const)[s];

/**
 * Brings customers and running loans over from the old desk software: pick the defaults, upload the Excel or CSV
 * export, match its columns, check every row, then import. Running it again skips accounts already imported.
 */
export default function Import() {
  const { t } = useTranslation();
  const toast = useToast();
  const [branchId, setBranchId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [productId, setProductId] = useState('');
  const [fundId, setFundId] = useState('');
  const [fileName, setFileName] = useState('');
  const [book, setBook] = useState<XLSX.WorkBook | null>(null);
  const [sheet, setSheet] = useState('');
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<Record<ImportField, number> | null>(null);
  const [preview, setPreview] = useState<Result | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [skipErrors, setSkipErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const { grid, first } = useMemo(() => (book && sheet ? sheetGrid(book, sheet) : { grid: [] as Cell[][], first: 1 }), [book, sheet]);
  const headers = grid[headerRow] ?? [];
  const width = Math.max(headers.length, ...grid.slice(headerRow + 1, headerRow + 20).map((r) => r.length));

  const rows = useMemo(() => {
    if (!mapping) return [];
    const out: Record<string, Cell | number | null>[] = [];
    grid.forEach((r, i) => {
      if (i <= headerRow) return;
      const row: Record<string, Cell | number | null> = { rowNo: first + i };
      for (const f of IMPORT_FIELDS) {
        const c = mapping[f];
        const v = c >= 0 ? r[c] : '';
        row[f] = v === '' || v == null ? null : typeof v === 'string' ? v.trim() || null : v;
      }
      // Blank lines and totals rows have no account number and no real name.
      if (row.accountNo == null && (row.name == null || /^(grand\s*)?total\b/i.test(String(row.name))) && row.nameTamil == null) return;
      out.push(row);
    });
    return out;
  }, [grid, first, headerRow, mapping]);

  const reset = () => {
    setPreview(null);
    setResult(null);
  };
  const pickSheet = (wb: XLSX.WorkBook, name: string) => {
    setSheet(name);
    const g = sheetGrid(wb, name).grid;
    const h = findHeaderRow(g);
    setHeaderRow(h);
    setMapping(guessMapping(g[h] ?? []));
    reset();
  };
  const onFile = async (file: File | undefined) => {
    setError(null);
    reset();
    if (!file) return;
    try {
      const wb = await readSheet(file);
      setFileName(file.name);
      setBook(wb);
      pickSheet(wb, wb.SheetNames[0]);
    } catch (e) {
      setBook(null);
      setError(new Error(t('import.cannotRead', { error: (e as Error).message })));
    }
  };
  const setHeader = (i: number) => {
    setHeaderRow(i);
    setMapping(guessMapping(grid[i] ?? []));
    reset();
  };

  const missing = mapping ? IMPORT_REQUIRED.filter((f) => mapping[f] < 0 && !(f === 'name' && mapping.nameTamil >= 0)) : [];
  const canCheck = !!mapping && !!productId && rows.length > 0 && rows.length <= IMPORT_MAX_ROWS && !missing.length;
  const request = (extra: object = {}) => ({ branchId: branchId || null, routeId: routeId || null, productId, fundId: fundId || null, fileName, rows, ...extra });

  const check = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setPreview(await post<Result>('/imports/preview', request()));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<Result>('/imports/run', request({ skipErrors }));
      setResult(r);
      setPreview(null);
      clearLookups();
      toast(t('import.done', { count: r.summary.imported ?? 0 }));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const issueText = (i: Issue) =>
    t(`import.issues.${i.code}`, {
      ...i.params,
      field: i.params?.field ? t(`import.fields.${i.params.field}`) : '',
      defaultValue: i.message,
    });
  const shown = (result ?? preview)?.rows.filter((r) => !onlyProblems || r.errors.length || r.warnings.length) ?? [];
  const s = (result ?? preview)?.summary;
  const colName = (c: number) => {
    const h = String(headers[c] ?? '').trim();
    return `${XLSX.utils.encode_col(c)}${h ? ` · ${h}` : ''}`;
  };
  const sample = (f: ImportField, c: number) => {
    const row = grid.slice(headerRow + 1).find((r) => r[c] !== '' && r[c] != null);
    if (!row) return '';
    const d = DATE_FIELDS.includes(f) ? importDate(row[c]) : null;
    return d && d !== 'invalid' ? dateIN(d) : String(row[c]);
  };

  return (
    <div>
      <div className="page-head">
        <h1>{t('import.title')}</h1>
        <button className="btn" onClick={downloadTemplate}>
          <Download aria-hidden />
          {t('import.template')}
        </button>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>{t('import.help')}</p>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>1. {t('import.defaults')}</h3>
        <div className="form">
          <Field label={t('common.branch')}>
            <BranchPicker value={branchId} onChange={(v) => { setBranchId(v); setRouteId(''); setFundId(''); reset(); }} />
          </Field>
          <Field label={t('import.defaultLine')}>
            <RoutePicker value={routeId} branchId={branchId || undefined} onChange={(v) => { setRouteId(v); reset(); }} />
          </Field>
          <Field label={t('common.product')}>
            <ProductPicker value={productId} onChange={(v) => { setProductId(v); reset(); }} />
          </Field>
          <Field label={t('import.fund')}>
            <FundPicker value={fundId} branchId={branchId || undefined} onChange={(v) => { setFundId(v); reset(); }} />
          </Field>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>{t('import.defaultsHelp')}</p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>2. {t('import.file')}</h3>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field" style={{ flex: '2 1 240px' }}>
            <span>{t('import.chooseFile')}</span>
            <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {book && book.SheetNames.length > 1 && (
            <label className="field" style={{ flex: '1 1 160px' }}>
              <span>{t('import.sheet')}</span>
              <select value={sheet} onChange={(e) => pickSheet(book, e.target.value)}>
                {book.SheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          )}
          {book && (
            <label className="field" style={{ flex: '1 1 160px' }}>
              <span>{t('import.headerRow')}</span>
              <select value={headerRow} onChange={(e) => setHeader(Number(e.target.value))}>
                {grid.slice(0, 15).map((r, i) => (
                  <option key={i} value={i}>{`${first + i}: ${r.filter((c) => c !== '').slice(0, 4).join(' | ').slice(0, 50)}`}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {book && <p className="muted" style={{ marginBottom: 0 }}><FileUp aria-hidden style={{ width: 15, height: 15, verticalAlign: -2 }} /> {fileName} · {t('import.rowsFound', { count: rows.length })}</p>}
        {rows.length > IMPORT_MAX_ROWS && <p><Badge tone="danger">{t('import.tooMany', { max: IMPORT_MAX_ROWS })}</Badge></p>}
      </div>

      {mapping && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>3. {t('import.mapping')}</h3>
          <p className="muted">{t('import.mappingHelp')}</p>
          <div className="form">
            {IMPORT_FIELDS.map((f) => (
              <Field key={f} label={`${t(`import.fields.${f}`)}${IMPORT_REQUIRED.includes(f) ? ' *' : ''}`} error={missing.includes(f) ? t('import.required') : undefined}>
                <select value={mapping[f]} onChange={(e) => { setMapping({ ...mapping, [f]: Number(e.target.value) }); reset(); }}>
                  <option value={-1}>{t('import.notInFile')}</option>
                  {Array.from({ length: width }, (_, c) => <option key={c} value={c}>{colName(c)}</option>)}
                </select>
                {mapping[f] >= 0 && <span className="muted" style={{ fontSize: 12 }}>{t('import.example')}: {sample(f, mapping[f]) || '-'}</span>}
              </Field>
            ))}
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn primary" disabled={!canCheck || busy} onClick={() => void check()}>
              <ListChecks aria-hidden />
              {busy && !preview ? t('common.loading') : t('import.check')}
            </button>
            {!productId && <span className="muted">{t('import.chooseProduct')}</span>}
          </div>
        </div>
      )}

      <ErrorBox error={error} />

      {s && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{result ? t('import.resultTitle') : `4. ${t('import.previewTitle')}`}</h3>
          <div className="grid k4">
            {result && <Stat label={t('import.imported')} value={s.imported ?? 0} tone="ok" />}
            <Stat label={t('import.newLoans')} value={s.newLoans} sub={`${t('import.balance')}: ${money(s.balance)}`} />
            <Stat label={t('import.newCustomers')} value={s.newCustomers} sub={`${t('import.reusedCustomers')}: ${s.reusedCustomers}`} />
            <Stat label={t('import.existing')} value={s.existing} sub={`${t('import.closedSkipped')}: ${s.closed}`} />
            <Stat label={t('import.withErrors')} value={s.errors} sub={`${t('import.withWarnings')}: ${s.warnings}`} />
            <Stat label={t('import.loanAmount')} value={money(s.principal)} sub={`${t('import.receivedBefore')}: ${money(s.paid)}`} />
          </div>
          {preview && (
            <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
              {s.errors > 0 && (
                <label className="row" style={{ gap: 6 }}>
                  <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
                  {t('import.skipErrors', { count: s.errors })}
                </label>
              )}
              <span className="spacer" />
              <button className="btn primary" disabled={busy || s.newLoans === 0 || (s.errors > 0 && !skipErrors)} onClick={() => void run()}>
                <Upload aria-hidden />
                {busy ? t('common.loading') : t('import.run', { count: s.newLoans })}
              </button>
            </div>
          )}
          {result && <p><Link to="/loans">{t('import.openLoans')}</Link></p>}
          <label className="row" style={{ gap: 6, marginBottom: 8 }}>
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
            {t('import.onlyProblems')}
          </label>
          <DataTable
            title={result ? t('import.resultTitle') : t('import.previewTitle')}
            rows={shown.map((r) => ({ ...r, id: String(r.rowNo) }))}
            columns={[
              { key: 'rowNo', label: t('import.row'), num: true },
              {
                key: 'status',
                label: t('common.status'),
                value: (r) => t(`import.statuses.${r.status}`),
                render: (r) => <Badge tone={statusTone(r.status)}>{t(`import.statuses.${r.status}`)}</Badge>,
              },
              { key: 'accountNo', label: t('import.fields.accountNo') },
              { key: 'name', label: t('import.fields.name') },
              { key: 'phone', label: t('import.fields.phone') },
              { key: 'line', label: t('import.fields.line') },
              {
                key: 'customer',
                label: t('import.customer'),
                value: (r) =>
                  !r.customer ? '' : r.customer.action === 'CREATE' ? (r.customerCode ?? t('import.newCustomer')) : r.customer.action === 'REUSE' ? `${r.customer.code}` : t('import.sameCustomer'),
              },
              {
                key: 'loan',
                label: t('import.loanNo'),
                value: (r) => (r.loan ?? r.existingLoan)?.number ?? '',
                render: (r) => {
                  const l = r.loan ?? r.existingLoan;
                  return l ? <Link to={`/loans/${l.id}`}>{l.number}</Link> : '';
                },
              },
              { key: 'principal', label: t('import.fields.loanAmount'), money: true, total: true },
              { key: 'totalPayable', label: t('import.fields.totalPayable'), money: true },
              { key: 'paid', label: t('import.fields.received'), money: true, total: true },
              { key: 'balance', label: t('import.fields.balance'), money: true, total: true },
              { key: 'instalment', label: t('import.fields.instalment'), value: (r) => (r.instalment != null ? `${money(r.instalment)} × ${r.tenure}` : '') },
              { key: 'loanDate', label: t('import.fields.loanDate'), value: (r) => dateIN(r.loanDate) },
              { key: 'maturityDate', label: t('import.fields.maturityDate'), value: (r) => dateIN(r.maturityDate) },
              {
                key: 'messages',
                label: t('import.messages'),
                value: (r) => [...r.errors, ...r.warnings].map(issueText).join('; '),
                render: (r) => (
                  <div style={{ display: 'grid', gap: 2, minWidth: 220 }}>
                    {r.errors.map((i, k) => <span key={`e${k}`} style={{ color: 'var(--danger)' }}>{issueText(i)}</span>)}
                    {r.warnings.map((i, k) => <span key={`w${k}`} style={{ color: 'var(--warn)' }}>{issueText(i)}</span>)}
                  </div>
                ),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
