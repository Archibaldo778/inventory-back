import assert from 'node:assert/strict';
import test from 'node:test';
import { askOccAssistant, likelySiteIssue } from '../utils/assistantAi.js';

test('site issue heuristic distinguishes website trouble from event problems', () => {
  assert.equal(likelySiteIssue('The save button on the site does not work'), true);
  assert.equal(likelySiteIssue('На странице ивента пропала кнопка Save'), true);
  assert.equal(likelySiteIssue('Какие проблемы были на этом ивенте?'), false);
});

test('assistant response normalizes the structured OpenAI result', async () => {
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.model, 'test-model');
    assert.match(request.input, /Gold centerpiece/);
    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          reply: 'I found matching decor.',
          siteIssue: { detected: false, severity: 'low', summary: '' },
          uiAction: { kind: 'filter_decor', query: 'centerpiece', colors: ['Gold'] },
        }),
      }),
    };
  };
  const previousModel = process.env.OPENAI_ASSISTANT_MODEL;
  process.env.OPENAI_ASSISTANT_MODEL = 'test-model';
  try {
    const result = await askOccAssistant({
      apiKey: 'unused',
      user: { username: 'Ivan', role: 'admin' },
      message: 'Gold centerpiece',
      context: { inventoryCandidates: [{ name: 'Gold stand' }] },
      fetchImpl,
    });
    assert.equal(result.reply, 'I found matching decor.');
    assert.deepEqual(result.uiAction, { kind: 'filter_decor', query: 'centerpiece', colors: ['Gold'] });
  } finally {
    if (previousModel === undefined) delete process.env.OPENAI_ASSISTANT_MODEL;
    else process.env.OPENAI_ASSISTANT_MODEL = previousModel;
  }
});
