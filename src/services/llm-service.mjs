import path from 'node:path';
import { pathToFileURL } from 'node:url';

function fallbackInterviewSummary(interview = {}) {
  const title = interview.title || 'Untitled SOP';
  const answers = Array.isArray(interview.answers) ? interview.answers : [];
  const lines = answers
    .map((item, index) => {
      const question = item.question || `Question ${index + 1}`;
      const answer = item.answer || '[Missing answer]';
      return `- ${question}: ${answer}`;
    })
    .join('\n');

  return {
    title,
    purpose: '[CONFIRM] Define SOP purpose from interview.',
    scope: '[CONFIRM] Define SOP scope from interview.',
    roles: [],
    procedureDraft: lines || '- [CONFIRM] Add interview details.',
    records: [],
    exceptions: [],
    source: 'fallback',
  };
}

function fallbackQuiz(document = {}) {
  const title = document.title || 'SOP';
  return [
    {
      id: 'q1',
      question: `What is the main purpose of "${title}"?`,
      expectedType: 'short-text',
    },
    {
      id: 'q2',
      question: 'Who is responsible for the first critical process step?',
      expectedType: 'short-text',
    },
    {
      id: 'q3',
      question: 'Where must required records be stored after execution?',
      expectedType: 'short-text',
    },
  ];
}

function fallbackProcessExtraction(rawText = '') {
  const chunks = String(rawText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const steps = chunks.length
    ? chunks.map((line, index) => ({
      order: index + 1,
      name: line.replace(/^[-*0-9. )]+/, '').trim() || `Step ${index + 1}`,
      role: '',
      inputs: [],
      outputs: [],
      records: [],
      exceptions: [],
    }))
    : [
      {
        order: 1,
        name: '[CONFIRM] Define first process step.',
        role: '',
        inputs: [],
        outputs: [],
        records: [],
        exceptions: [],
      },
    ];

  return {
    steps,
    source: 'fallback',
  };
}

export class LLMService {
  constructor({ libraryPath = null, enabled = true } = {}) {
    this.enabled = enabled;
    this.libraryPath =
      libraryPath ?? path.resolve(process.cwd(), '..', 'AchillesAgentLib', 'index.mjs');
    this.agentPromise = null;
  }

  async _createAgent() {
    if (!this.enabled) {
      return null;
    }

    const moduleUrl = pathToFileURL(this.libraryPath).href;
    const achilles = await import(moduleUrl);
    if (!achilles?.LLMAgent) {
      throw new Error('AchillesAgentLib does not export LLMAgent.');
    }

    return new achilles.LLMAgent({ name: 'SOPManagerAgent' });
  }

  async _getAgent() {
    if (!this.enabled) {
      return null;
    }
    if (!this.agentPromise) {
      this.agentPromise = this._createAgent().catch((error) => {
        this.agentPromise = null;
        throw error;
      });
    }
    return this.agentPromise;
  }

  async summarizeInterview(interviewPayload) {
    const fallback = fallbackInterviewSummary(interviewPayload);
    if (!this.enabled) {
      return fallback;
    }

    try {
      const agent = await this._getAgent();
      if (!agent) {
        return fallback;
      }

      const prompt = [
        'Summarize the interview into SOP-ready JSON.',
        'Return a JSON object with keys:',
        'title, purpose, scope, roles, procedureDraft, records, exceptions.',
        'Keep output concise and factual.',
        `Interview payload: ${JSON.stringify(interviewPayload)}`,
      ].join('\n');

      const response = await agent.executePrompt(prompt, {
        mode: 'fast',
        responseShape: 'json',
      });

      return {
        ...fallback,
        ...response,
        source: 'achilles',
      };
    } catch {
      return fallback;
    }
  }

  async generateQuiz(documentPayload) {
    const fallback = fallbackQuiz(documentPayload);
    if (!this.enabled) {
      return fallback;
    }

    try {
      const agent = await this._getAgent();
      if (!agent) {
        return fallback;
      }

      const prompt = [
        'Generate a quiz for SOP training.',
        'Return JSON array with 3 to 5 objects.',
        'Each object must have: id, question, expectedType.',
        `SOP payload: ${JSON.stringify(documentPayload)}`,
      ].join('\n');

      const response = await agent.executePrompt(prompt, {
        mode: 'fast',
        responseShape: 'json',
      });

      if (!Array.isArray(response) || !response.length) {
        return fallback;
      }
      return response.slice(0, 5);
    } catch {
      return fallback;
    }
  }

  async extractProcessModel(rawProcessText) {
    const fallback = fallbackProcessExtraction(rawProcessText);
    if (!this.enabled) {
      return fallback;
    }

    try {
      const agent = await this._getAgent();
      if (!agent) {
        return fallback;
      }

      const prompt = [
        'Extract a process model from raw procedure text.',
        'Return JSON with key "steps".',
        'Each step must include: order, name, role, inputs, outputs, records, exceptions.',
        'Use empty values when not stated.',
        `Raw text: ${String(rawProcessText || '')}`,
      ].join('\n');

      const response = await agent.executePrompt(prompt, {
        mode: 'fast',
        responseShape: 'json',
      });

      const steps = Array.isArray(response?.steps) ? response.steps : null;
      if (!steps || !steps.length) {
        return fallback;
      }

      return {
        steps: steps.map((step, index) => ({
          order: Number(step.order) || index + 1,
          name: String(step.name || `Step ${index + 1}`),
          role: String(step.role || ''),
          inputs: Array.isArray(step.inputs) ? step.inputs : [],
          outputs: Array.isArray(step.outputs) ? step.outputs : [],
          records: Array.isArray(step.records) ? step.records : [],
          exceptions: Array.isArray(step.exceptions) ? step.exceptions : [],
        })),
        source: 'achilles',
      };
    } catch {
      return fallback;
    }
  }

  async executeJsonPrompt(prompt, { mode = 'fast', fallback = null } = {}) {
    if (!this.enabled) {
      return fallback;
    }

    try {
      const agent = await this._getAgent();
      if (!agent) {
        return fallback;
      }
      return await agent.executePrompt(String(prompt || ''), {
        mode,
        responseShape: 'json',
      });
    } catch {
      return fallback;
    }
  }

  async executeTextPrompt(prompt, { mode = 'fast', fallback = '' } = {}) {
    if (!this.enabled) {
      return fallback;
    }
    try {
      const agent = await this._getAgent();
      if (!agent) {
        return fallback;
      }
      return await agent.executePrompt(String(prompt || ''), {
        mode,
      });
    } catch {
      return fallback;
    }
  }
}
