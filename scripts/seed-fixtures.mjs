export function buildDocument({
  title,
  purpose,
  scope,
  responsibilities,
  procedure,
  records,
  exceptions,
  references = [],
  steps = [],
}) {
  return {
    title,
    sections: [
      { id: 'purpose', title: 'Purpose', text: purpose },
      { id: 'scope', title: 'Scope', text: scope },
      { id: 'responsibilities', title: 'Responsibilities', text: responsibilities },
      { id: 'procedure', title: 'Procedure', text: procedure },
      { id: 'records', title: 'Records', text: records },
      { id: 'exceptions', title: 'Exceptions', text: exceptions },
    ],
    processModel: {
      steps: steps.map((step, index) => ({
        order: index + 1,
        name: step.name,
        role: step.role,
        inputs: step.inputs || [],
        outputs: step.outputs || [],
        records: step.records || [],
        exceptions: step.exceptions || [],
      })),
    },
    references,
    trainingTaskIds: [],
  };
}

export const BLOCK_DEFINITIONS = [
  {
    id: 'block-safety-ppe-gate',
    title: 'Safety PPE Gate',
    mode: 'linked',
    parameterSchema: ['ppeItems', 'area'],
    contentTemplate: 'Before execution in {{area}}, verify PPE: {{ppeItems}}.',
  },
  {
    id: 'block-record-retention',
    title: 'Record Retention Clause',
    mode: 'linked',
    parameterSchema: ['storage', 'period'],
    contentTemplate: 'Store generated records in {{storage}} for {{period}}.',
  },
  {
    id: 'block-deviation-trigger',
    title: 'Deviation Trigger Rule',
    mode: 'detached',
    parameterSchema: ['threshold', 'channel'],
    contentTemplate: 'If deviation exceeds {{threshold}}, escalate through {{channel}} immediately.',
  },
];

export const SOP_DEFINITIONS = [
  {
    code: 'SOP-QA-001',
    title: 'Raw Material Receiving and Inspection',
    area: 'Quality Assurance',
    targetRoles: ['author', 'reviewer', 'approver'],
    document: buildDocument({
      title: 'Raw Material Receiving and Inspection',
      purpose: 'Define controlled receiving and inspection steps for incoming raw materials.',
      scope: 'Applies to all incoming raw materials at site warehouse and quality hold area.',
      responsibilities: 'Warehouse Operator receives material; QA Inspector performs acceptance checks.',
      procedure: 'Receive shipment, verify supplier documents, inspect packaging integrity, sample as required, release or quarantine.',
      records: 'Receiving Log RM-01, Inspection Checklist RM-02, Quarantine Report RM-03.',
      exceptions: 'Damaged lots are quarantined and escalated to QA Lead and Procurement within 2 hours.',
      references: [
        { label: 'Receiving Form', type: 'form', target: 'FORM-RM-01' },
        { label: 'Vendor Qualification', type: 'sop', target: 'SOP-SCM-004' },
      ],
      steps: [
        { name: 'Receive shipment at controlled dock', role: 'warehouse_operator', inputs: ['delivery_note'], outputs: ['received_lot'], records: ['RM-01'] },
        { name: 'Verify supplier documentation', role: 'warehouse_operator', inputs: ['certificate_of_analysis'], outputs: ['doc_check_result'], records: ['RM-02'] },
        { name: 'Inspect packaging and labels', role: 'qa_inspector', inputs: ['received_lot'], outputs: ['inspection_outcome'], records: ['RM-02'] },
        { name: 'Release or quarantine lot', role: 'qa_inspector', inputs: ['inspection_outcome'], outputs: ['released_lot_or_quarantine'], records: ['RM-03'], exceptions: ['damaged_packaging'] },
      ],
    }),
  },
  {
    code: 'SOP-OPS-010',
    title: 'Equipment Cleaning and Line Release',
    area: 'Operations',
    targetRoles: ['author', 'reviewer'],
    document: buildDocument({
      title: 'Equipment Cleaning and Line Release',
      purpose: 'Ensure equipment cleaning and release before production startup.',
      scope: 'Applies to all granulation and compression lines.',
      responsibilities: 'Operator executes cleaning; Supervisor verifies completeness.',
      procedure: 'Stop line, isolate utilities, execute cleaning sequence, verify residues, complete release checklist.',
      records: 'Cleaning Log CL-11 and Release Checklist CL-12.',
      exceptions: 'Residual contamination above limit triggers deviation and recleaning.',
      references: [
        { label: 'Incoming Material SOP', type: 'sop', target: 'SOP-QA-001' },
      ],
      steps: [
        { name: 'Isolate line and utilities', role: 'line_operator', inputs: ['line_status'], outputs: ['safe_state'], records: ['CL-11'] },
        { name: 'Execute cleaning protocol', role: 'line_operator', inputs: ['cleaning_kit'], outputs: ['cleaned_equipment'], records: ['CL-11'] },
        { name: 'Supervisor verification and release', role: 'production_supervisor', inputs: ['cleaned_equipment'], outputs: ['line_release_status'], records: ['CL-12'] },
      ],
    }),
  },
  {
    code: 'SOP-QA-020',
    title: 'Deviation Handling and CAPA Trigger',
    area: 'Quality Assurance',
    targetRoles: ['author', 'reviewer', 'approver'],
    document: buildDocument({
      title: 'Deviation Handling and CAPA Trigger',
      purpose: 'Define the standard method for managing process deviations and CAPA initiation.',
      scope: 'Applies to all GMP-impacting deviations in production and quality operations.',
      responsibilities: 'Process Owner reports deviation; QA Manager classifies and approves CAPA path.',
      procedure: 'Log deviation, perform preliminary classification, execute root-cause analysis, decide CAPA as needed.',
      records: 'Deviation Ticket DV-01, Investigation Record DV-02, CAPA Plan DV-03.',
      exceptions: 'Critical deviations require immediate escalation to Site Head.',
      references: [
        { label: 'Cleaning SOP', type: 'sop', target: 'SOP-OPS-010' },
      ],
      steps: [
        { name: 'Register deviation in system', role: 'process_owner', inputs: ['deviation_signal'], outputs: ['deviation_ticket'], records: ['DV-01'] },
        { name: 'Classify deviation severity', role: 'qa_manager', inputs: ['deviation_ticket'], outputs: ['severity_class'], records: ['DV-02'] },
        { name: 'Define CAPA requirement', role: 'qa_manager', inputs: ['severity_class'], outputs: ['capa_decision'], records: ['DV-03'] },
      ],
    }),
  },
  {
    code: 'SOP-QA-030',
    title: 'Batch Record Final Review and Release',
    area: 'Quality Assurance',
    targetRoles: ['reviewer', 'approver'],
    document: buildDocument({
      title: 'Batch Record Final Review and Release',
      purpose: 'Ensure complete review and release decision for executed batch records.',
      scope: 'Covers completed manufacturing batches pending final QA release.',
      responsibilities: 'QA Reviewer performs record check; QA Approver provides release decision.',
      procedure: 'Collect full batch package, review critical entries, verify deviations and CAPAs, sign release decision.',
      records: 'Batch Review Checklist BR-01 and Release Authorization BR-02.',
      exceptions: 'Incomplete records trigger hold status and remediation request.',
      references: [
        { label: 'Incoming Material SOP', type: 'sop', target: 'SOP-QA-001' },
        { label: 'Cleaning SOP', type: 'sop', target: 'SOP-OPS-010' },
        { label: 'Deviation SOP', type: 'sop', target: 'SOP-QA-020' },
      ],
      steps: [
        { name: 'Assemble executed batch record package', role: 'qa_reviewer', inputs: ['batch_documents'], outputs: ['review_package'], records: ['BR-01'] },
        { name: 'Perform completeness and compliance review', role: 'qa_reviewer', inputs: ['review_package'], outputs: ['review_outcome'], records: ['BR-01'] },
        { name: 'Approve or hold batch release', role: 'qa_approver', inputs: ['review_outcome'], outputs: ['release_status'], records: ['BR-02'] },
      ],
    }),
  },
];
