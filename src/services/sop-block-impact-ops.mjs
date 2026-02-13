import { HttpError } from '../lib/http.mjs';
import {
  createBaseDocument,
  renderTemplate,
} from './sop-document-utils.mjs';

export async function createSopBlock(service, { actor, payload = {} }) {
  if (!payload.title || !String(payload.title).trim()) {
    throw new HttpError(400, 'Block title is required.');
  }
  if (!payload.contentTemplate || !String(payload.contentTemplate).trim()) {
    throw new HttpError(400, 'Block contentTemplate is required.');
  }

  const block = await service.documentStore.createBlock({
    blockId: payload.id,
    title: payload.title,
    contentTemplate: payload.contentTemplate,
    parameterSchema: payload.parameterSchema,
    mode: payload.mode,
    actorId: actor.id,
  });

  await service.auditStore.append({
    actorId: actor.id,
    action: 'block.create',
    entityType: 'block',
    entityId: block.id,
    payload: {
      title: block.title,
      mode: block.mode,
    },
  });

  return block;
}

export async function instantiateSopBlock(service, {
  sopId,
  actor,
  blockId,
  mode = null,
  parameters = {},
  sectionId = null,
}) {
  const sop = await service.getSop(sopId);
  const block = await service.documentStore.getBlock(blockId);
  if (!block) {
    throw new HttpError(404, `Block "${blockId}" not found.`);
  }

  const document = structuredClone(sop.latestVersion?.document || createBaseDocument({}));
  const rendered = renderTemplate(block.contentTemplate, parameters || {});
  const finalMode = mode || block.mode || 'linked';
  const generatedSectionId = sectionId || `block-${blockId}-${Date.now()}`;

  const section = {
    id: generatedSectionId,
    title: block.title,
    text: rendered,
    source: {
      type: 'block',
      blockId: block.id,
      mode: finalMode === 'detached' ? 'detached' : 'linked',
      parameters: parameters || {},
    },
  };

  if (!Array.isArray(document.sections)) {
    document.sections = [];
  }
  document.sections.push(section);

  const version = await service.createVersion({
    sopId,
    actor,
    document,
    changeSummary: `Instantiated block ${block.id} as ${section.id}.`,
  });

  await service.auditStore.append({
    actorId: actor.id,
    action: 'block.instantiate',
    entityType: 'sop',
    entityId: sopId,
    payload: {
      blockId: block.id,
      mode: section.source.mode,
      sectionId: section.id,
    },
  });

  return {
    section,
    version,
  };
}

export async function analyzeSopImpact(service, sopId) {
  const target = await service.getSop(sopId);
  const doc = target.latestVersion?.document || {};
  const references = Array.isArray(doc.references) ? doc.references : [];
  const sections = Array.isArray(doc.sections) ? doc.sections : [];
  const linkedBlocks = sections
    .filter((section) => section?.source?.type === 'block' && section?.source?.mode === 'linked')
    .map((section) => ({
      sectionId: section.id,
      blockId: section.source.blockId,
    }));

  const allSops = await service.listSops();
  const reverseReferences = [];

  for (const item of allSops) {
    if (item.id === sopId) {
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    const candidate = await service.getSop(item.id);
    const candidateReferences = Array.isArray(candidate.latestVersion?.document?.references)
      ? candidate.latestVersion.document.references
      : [];
    const matched = candidateReferences.some((ref) => ref?.target === sopId || ref?.target === target.meta.code);
    if (matched) {
      reverseReferences.push({
        sopId: candidate.meta.id,
        title: candidate.meta.title,
        status: candidate.meta.status,
      });
    }
  }

  return {
    sopId,
    references: references.map((reference) => ({
      label: reference.label || '',
      target: reference.target || '',
      type: reference.type || '',
    })),
    linkedBlocks,
    reverseReferences,
  };
}
