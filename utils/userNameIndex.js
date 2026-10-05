const onlyField = (index, field) => Object.keys(index.key || {}).length === 1 && index.key[field] === 1;

export async function allowDuplicateUserNames(collection, { apply = false } = {}) {
  const indexes = await collection.listIndexes().toArray();
  if (!indexes.some((index) => onlyField(index, 'email') && index.unique === true && !index.partialFilterExpression && !index.sparse)) {
    throw new Error('A complete unique email index is required; no indexes were changed');
  }
  const names = indexes.filter((index) => onlyField(index, 'username') && index.unique === true).map((index) => index.name);
  if (apply) {
    for (const name of names) await collection.dropIndex(name);
  }
  return { apply, usernameIndexes: names };
}
