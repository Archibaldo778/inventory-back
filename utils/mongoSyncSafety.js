const parseMongoUri = (uri) => {
  const value = String(uri || '').trim();
  const separatorIndex = value.indexOf('://');
  if (separatorIndex < 0) throw new Error('Invalid MongoDB URI');

  const protocol = value.slice(0, separatorIndex).toLowerCase();
  if (!['mongodb', 'mongodb+srv'].includes(protocol)) {
    throw new Error('MongoDB URI must use mongodb:// or mongodb+srv://');
  }

  const remainder = value.slice(separatorIndex + 3);
  const queryIndex = remainder.indexOf('?');
  const withoutQuery = queryIndex >= 0 ? remainder.slice(0, queryIndex) : remainder;
  const slashIndex = withoutQuery.indexOf('/');
  const authority = slashIndex >= 0 ? withoutQuery.slice(0, slashIndex) : withoutQuery;
  const uriDbName = slashIndex >= 0 ? withoutQuery.slice(slashIndex + 1) : '';
  const credentialIndex = authority.lastIndexOf('@');
  const hosts = (credentialIndex >= 0 ? authority.slice(credentialIndex + 1) : authority)
    .split(',')
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
    .sort();

  if (hosts.length === 0) throw new Error('MongoDB URI has no host');
  return {
    protocol,
    hosts,
    uriDbName: decodeURIComponent(uriDbName || '').trim(),
  };
};

export const resolveMongoTarget = (uri, explicitDbName) => {
  const parsed = parseMongoUri(uri);
  const dbName = String(explicitDbName || parsed.uriDbName || '').trim();
  if (!dbName) {
    throw new Error('MongoDB database name must be explicit in the URI or MONGO_DB_NAME_*');
  }
  return {
    ...parsed,
    dbName,
    identity: `${parsed.protocol}://${parsed.hosts.join(',')}/${dbName.toLowerCase()}`,
  };
};

export const assertDistinctMongoTargets = ({
  prodUri,
  prodDbName,
  devUri,
  devDbName,
}) => {
  const prodTarget = resolveMongoTarget(prodUri, prodDbName);
  const devTarget = resolveMongoTarget(devUri, devDbName);
  if (prodTarget.identity === devTarget.identity) {
    throw new Error('Refusing to run: production and development resolve to the same target');
  }
  return { prodTarget, devTarget };
};

export const describeMongoTarget = (target) => (
  `${target.protocol}://${target.hosts.join(',')}/${target.dbName}`
);
