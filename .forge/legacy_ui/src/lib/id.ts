export const createLocalId = () => Math.random().toString(36).substring(2, 15) + Date.now().toString(36);

export const createPrefixedId = (prefix: string) => `${prefix}${createLocalId()}`;