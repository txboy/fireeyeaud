import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rendererSrc = join(here, '..', 'src');

function read(rel: string): string {
  return readFileSync(join(rendererSrc, rel), 'utf8');
}

test('activity rail exposes an evidence-form entry next to reports', () => {
  const rail = read('components/ActivityRail.tsx');
  const reportsAt = rail.indexOf("view: 'reports'");
  const formsAt = rail.indexOf("view: 'evidenceForms'");
  assert.ok(reportsAt > -1, 'reports entry missing');
  assert.ok(formsAt > reportsAt, 'evidenceForms should follow reports in the rail');

  const sidebar = read('components/SideBar.tsx');
  assert.match(sidebar, /case 'evidenceForms':\s*\n\s*return <EvidenceFormsPanel \/>/);
});

test('results column no longer carries an evidence-form tab', () => {
  const results = read('components/ResultsColumn.tsx');
  assert.doesNotMatch(results, /evidence-form/);
  assert.doesNotMatch(results, /EvidenceFormsView/);
});

test('the standalone evidence-form panel is a two-pane records view', () => {
  const panel = read('components/forms/EvidenceFormsPanel.tsx');
  assert.match(panel, /t\('records'\)/);
  assert.match(panel, /t\('formOverview'\)/);
  assert.match(panel, /openEvidenceForm/);
});