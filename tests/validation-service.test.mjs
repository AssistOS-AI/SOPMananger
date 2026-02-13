import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidationService } from '../src/services/validation-service.mjs';

const rules = {
  requiredSections: [
    { id: 'purpose', title: 'Purpose' },
    { id: 'scope', title: 'Scope' },
  ],
  ambiguousTerms: ['as needed'],
};

test('ValidationService reports missing required sections and missing process role', async () => {
  const validator = new ValidationService({ rules });
  await validator.initialize();

  const document = {
    title: 'Example SOP',
    sections: [{ id: 'purpose', title: 'Purpose', text: 'Do this as needed.' }],
    processModel: {
      steps: [{ name: 'Check input' }],
    },
  };

  const result = validator.validate(document, { status: 'Draft' });
  assert.equal(result.summary.blocking, 2);
  assert.equal(result.summary.warning >= 1, true);

  const hasScopeMissing = result.findings.some((item) => item.ruleId === 'required-section');
  const hasMissingRole = result.findings.some((item) => item.ruleId === 'step-role-required');
  const hasAmbiguity = result.findings.some((item) => item.ruleId === 'ambiguous-language');

  assert.equal(hasScopeMissing, true);
  assert.equal(hasMissingRole, true);
  assert.equal(hasAmbiguity, true);
});

test('ValidationService requires training linkage when SOP is effective', async () => {
  const validator = new ValidationService({ rules });
  await validator.initialize();

  const document = {
    sections: [
      { id: 'purpose', title: 'Purpose', text: 'Purpose text.' },
      { id: 'scope', title: 'Scope', text: 'Scope text.' },
    ],
    processModel: { steps: [{ name: 'Run', role: 'operator' }] },
    trainingTaskIds: [],
  };

  const result = validator.validate(document, { status: 'Effective' });
  const hasTrainingBlock = result.findings.some((item) => item.ruleId === 'effective-training-link');
  assert.equal(hasTrainingBlock, true);
});
