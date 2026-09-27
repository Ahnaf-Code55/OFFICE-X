'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');
const { ollamaTagFor, minRamGb } = loadTs('src/shared/ossModels.ts');

test('Hugging Face repos, URLs and plain tags map to Ollama pull names', () => {
  assert.equal(ollamaTagFor('mradermacher/DeepHat-V1-7B-GGUF'), 'hf.co/mradermacher/DeepHat-V1-7B-GGUF');
  assert.equal(ollamaTagFor(' hf.co/mradermacher/RedSage-Qwen3-8B-Ins-GGUF:Q4_K_M '), 'hf.co/mradermacher/RedSage-Qwen3-8B-Ins-GGUF:Q4_K_M');
  assert.equal(ollamaTagFor('https://huggingface.co/mradermacher/DeepHat-V1-7B-GGUF/tree/main'), 'hf.co/mradermacher/DeepHat-V1-7B-GGUF');
  assert.equal(ollamaTagFor('qwen3:8b'), 'qwen3:8b');
  assert.equal(ollamaTagFor('rm -rf /'), null);
  assert.equal(ollamaTagFor(''), null);
  assert.equal(minRamGb('16–32 GB'), 16);
});
