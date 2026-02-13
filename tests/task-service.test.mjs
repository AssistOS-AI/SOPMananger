import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskService } from '../src/services/task-service.mjs';

async function waitForCompletion(service, taskId, attempts = 30) {
  for (let index = 0; index < attempts; index += 1) {
    const task = service.getTask(taskId, { actorId: 'u-1', isAdmin: true });
    if (task.status === 'completed' || task.status === 'failed') {
      return task;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return service.getTask(taskId, { actorId: 'u-1', isAdmin: true });
}

test('TaskService executes long-running task and stores progress/result', async () => {
  const service = new TaskService();

  const task = await service.createTask({
    type: 'assurance-scan',
    title: 'Test scan',
    actorId: 'u-1',
    input: { sample: true },
    runner: async ({ update }) => {
      update({ progress: 40, message: 'Halfway.' });
      await new Promise((resolve) => setTimeout(resolve, 30));
      update({ progress: 80, message: 'Almost done.' });
      return { ok: true, score: 91 };
    },
  });

  assert.equal(task.type, 'assurance-scan');
  assert.equal(task.actorId, 'u-1');
  assert.equal(task.status === 'queued' || task.status === 'running' || task.status === 'completed', true);

  const done = await waitForCompletion(service, task.id);
  assert.equal(done.status, 'completed');
  assert.equal(done.progress, 100);
  assert.equal(done.result.ok, true);
  assert.equal(Array.isArray(done.logs), true);
  assert.equal(done.logs.length > 0, true);
});
