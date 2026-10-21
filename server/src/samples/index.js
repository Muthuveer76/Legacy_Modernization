import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SAMPLES = [
  {
    id: 'cobol-payroll',
    name: 'Weekly Payroll (COBOL)',
    description: 'Gross pay with overtime, tiered tax via EVALUATE, OCCURS tables, level-88 flags and an unreachable audit paragraph.',
    language: 'cobol',
    file: 'PAYROLL.cbl',
    target: { language: 'java', framework: 'plain' },
  },
  {
    id: 'vb6-inventory',
    name: 'Inventory Reorder (VB6)',
    description: 'Module-level arrays, Currency math, Select Case discounts, single-line statements joined with colons.',
    language: 'vb6',
    file: 'InventoryModule.bas',
    target: { language: 'csharp', framework: 'plain' },
  },
  {
    id: 'java-ledger',
    name: 'Account Ledger (Java 1.4)',
    description: 'Raw Hashtable/Vector collections, manual boxing, synchronized methods and StringBuffer reporting.',
    language: 'java',
    file: 'LegacyAccountService.java',
    target: { language: 'java', framework: 'spring-boot' },
  },
  {
    id: 'cpp-billing',
    name: 'Invoice Billing (C-style C++)',
    description: 'Fixed-size struct arrays, #define constants, strcpy and printf formatting.',
    language: 'cpp',
    file: 'billing.cpp',
    target: { language: 'python', framework: 'plain' },
  },
];

export function loadSample(id) {
  const sample = SAMPLES.find((s) => s.id === id);
  if (!sample) return null;
  return { ...sample, content: fs.readFileSync(path.join(here, sample.file), 'utf8') };
}
