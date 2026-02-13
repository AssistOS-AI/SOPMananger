export async function handleFilterSubmit(form, { navigate }) {
  if (form.dataset.action !== 'apply-sop-list-filter') {
    return false;
  }
  const status = form.querySelector('[name="status"]').value || 'all';
  const search = form.querySelector('[name="search"]').value.trim();
  const params = new URLSearchParams();
  if (status && status !== 'all') {
    params.set('status', status);
  } else {
    params.set('status', 'all');
  }
  if (search) {
    params.set('search', search);
  }
  navigate(`/sops?${params.toString()}`);
  return true;
}

export async function submitRouter(event, ctx) {
  const form = event.target.closest('form[data-action]');
  if (!form) {
    return;
  }
  if (await handleFilterSubmit(form, ctx)) {
    event.preventDefault();
    return;
  }
  await ctx.handleSubmit(event, ctx);
}
